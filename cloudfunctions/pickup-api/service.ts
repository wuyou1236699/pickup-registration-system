import { createHash } from 'node:crypto'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { MutationRequest, MutationResponse, Person, RegistrationResult, ServiceSnapshot } from '../../shared/contracts'
import { ServiceError } from './errors'

import { validateMutation, validateRoster, rosterHash } from '../../shared/server-validation'
export { validateMutation, validateRoster, rosterHash } from '../../shared/server-validation'

function parseJson<T>(value: T | string): T { return typeof value === 'string' ? JSON.parse(value) as T : value }
function codeOf(error: unknown): string { return error && typeof error === 'object' && 'code' in error ? String(error.code) : '' }

export class PickupService {
  constructor(private readonly pool: Pool, private readonly fault?: (point: string) => void) {}
  // All mutations lock this one permanent DB row first. With 2–3 operators this is
  // deliberately simpler than optimistic number allocation; the lock spans commit.
  private async transaction<T>(work: (connection: PoolConnection) => Promise<T>, readOnly = false): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const conn = await this.pool.getConnection()
      let committing = false
      try {
        await conn.query('SET SESSION innodb_lock_wait_timeout=3')
        await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        await conn.query(readOnly ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION')
        if (!readOnly) await conn.query('SELECT id FROM pickup_control WHERE id=1 FOR UPDATE')
        const output = await work(conn)
        committing = true
        await conn.commit()
        return output
      } catch (error) {
        try { await conn.rollback() } catch { conn.destroy() }
        // Lost connection during COMMIT must not be reported as a definite failure.
        if (committing && !readOnly) throw new ServiceError('RESULT_UNKNOWN', '提交结果尚未确定，请使用原请求恢复结果，勿重新发牌', true)
        if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(codeOf(error)) && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1) + Math.random() * 40))
          continue
        }
        throw error
      } finally { conn.release() }
    }
  }
  private async snapshotIn(conn: PoolConnection): Promise<ServiceSnapshot> {
    const [rosters] = await conn.query<RowDataPacket[]>('SELECT version, content_hash, person_count, is_demo FROM pickup_roster WHERE id=1')
    if (!rosters.length) throw new ServiceError('NOT_INITIALIZED', '尚未初始化名单，请联系现场负责人')
    const [control] = await conn.query<RowDataPacket[]>('SELECT next_number, revision FROM pickup_control WHERE id=1')
    const [rows] = await conn.query<RowDataPacket[]>('SELECT p.id,p.name,p.company,p.source_json,p.assignment_version,a.ticket_number FROM pickup_people p LEFT JOIN pickup_assignments a ON a.person_id=p.id ORDER BY p.roster_order')
    const [tickets] = await conn.query<RowDataPacket[]>('SELECT number FROM pickup_tickets ORDER BY number')
    const assignments: Record<string, number> = Object.create(null), versions: Record<string, number> = Object.create(null)
    const people: Person[] = rows.map(row => {
      if (row.ticket_number !== null) assignments[row.id] = Number(row.ticket_number)
      versions[row.id] = Number(row.assignment_version)
      return { id: row.id, name: row.name, company: row.company, source: parseJson<Person['source']>(row.source_json) }
    })
    if (people.length !== Number(rosters[0].person_count)) throw new ServiceError('ROSTER_INCONSISTENT', '名单完整性校验失败，已停止操作')
    return { people, state: { assignments, versions, issuedNumbers: tickets.map(t => Number(t.number)), nextNumber: Number(control[0].next_number), revision: Number(control[0].revision), batches: [] }, roster: { version: rosters[0].version, hash: rosters[0].content_hash, count: people.length, demo: Boolean(rosters[0].is_demo) }, generatedAt: new Date().toISOString() }
  }
  snapshot(): Promise<ServiceSnapshot> { return this.transaction(conn => this.snapshotIn(conn), true) }
  async initialize(input: unknown, version: string, expectedCount: number, demo: boolean): Promise<{ reused: boolean; hash: string }> {
    const people = validateRoster(input, version, expectedCount), hash = rosterHash(people, version)
    if (demo && !people.every(p => p.id.startsWith('demo-') && /^示例(学员|志工)\d{3}$/.test(p.name) && (p.company === '志工' || /^虚构企业\d{2}$/.test(p.company)))) throw new ServiceError('NOT_DEMO', '示例导入拒绝包含真实人员的名单')
    return this.transaction(async conn => {
      const [existing] = await conn.query<RowDataPacket[]>('SELECT content_hash,version,person_count,is_demo FROM pickup_roster WHERE id=1')
      if (existing.length) {
        if (existing[0].content_hash === hash && existing[0].version === version && Number(existing[0].person_count) === people.length && Boolean(existing[0].is_demo) === demo) {
          const actual = await this.snapshotIn(conn)
          if (rosterHash(actual.people, version) !== hash) throw new ServiceError('ROSTER_INCONSISTENT', '数据库名单内容已变化，拒绝初始化')
          return { reused: true, hash }
        }
        throw new ServiceError('ALREADY_INITIALIZED', '已有其他名单，拒绝覆盖或重置登记数据')
      }
      const [leftovers] = await conn.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM pickup_people) + (SELECT COUNT(*) FROM pickup_tickets) + (SELECT COUNT(*) FROM pickup_requests) AS count')
      if (Number(leftovers[0].count)) throw new ServiceError('NOT_EMPTY', '数据库已有数据，拒绝初始化')
      for (const [index,p] of people.entries()) await conn.execute('INSERT INTO pickup_people (id,name,company,source_json,roster_order) VALUES (?,?,?,?,?)', [p.id,p.name,p.company,JSON.stringify(p.source),index])
      await conn.execute('INSERT INTO pickup_roster (id,version,content_hash,person_count,is_demo) VALUES (1,?,?,?,?)', [version,hash,people.length,demo])
      return { reused: false, hash }
    })
  }
  async mutate(input: unknown): Promise<MutationResponse> {
    const req = validateMutation(input)
    const payload = req.operation === 'register' ? { ...req, ids: [...req.ids].sort() } : req
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    return this.transaction(async conn => {
      const [requests] = await conn.execute<RowDataPacket[]>('SELECT payload_hash,result_json FROM pickup_requests WHERE request_id=?', [req.requestId])
      if (requests.length) {
        if (requests[0].payload_hash !== hash) throw new ServiceError('REQUEST_REUSED', '同一请求标识不能用于不同操作')
        return { result: parseJson<RegistrationResult | null>(requests[0].result_json), snapshot: await this.snapshotIn(conn), replayed: true }
      }
      const before = await this.snapshotIn(conn)
      if (before.roster.hash !== req.rosterHash) throw new ServiceError('ROSTER_CHANGED', '名单版本已变化，请刷新并重新核对')
      const ids = req.operation === 'register' ? req.ids : [req.id]
      if (ids.some(id => !Object.hasOwn(before.state.versions ?? {}, id))) throw new ServiceError('PERSON_NOT_FOUND', '名单中不存在所选人员')
      let result: RegistrationResult | null = null
      const changes: { id: string; from: number | null; to: number | null }[] = []
      if (req.operation === 'register') {
        const fresh = ids.filter(id => before.state.assignments[id] === undefined)
        const existing = ids.filter(id => before.state.assignments[id] !== undefined).map(id => ({ id, number: before.state.assignments[id] }))
        const number = fresh.length ? before.state.nextNumber : null
        if (number !== null) {
          if (number > 999999) throw new ServiceError('NUMBER_LIMIT', '号码已达到上限，请联系负责人')
          await conn.execute('INSERT INTO pickup_tickets (number) VALUES (?)', [number])
          this.fault?.('after-ticket')
          for (const id of fresh) {
            await conn.execute('INSERT INTO pickup_assignments (person_id,ticket_number) VALUES (?,?)', [id,number])
            await conn.execute('UPDATE pickup_people SET assignment_version=assignment_version+1 WHERE id=?', [id])
            changes.push({ id, from: null, to: number })
          }
          await conn.execute('UPDATE pickup_control SET next_number=next_number+1 WHERE id=1')
        }
        result = { number, newlyAssigned: fresh, existing }
      } else {
        if (before.state.versions?.[req.id] !== req.expectedVersion) throw new ServiceError('ASSIGNMENT_CONFLICT', '此人员已被其他窗口修改，请核对最新归属后再纠正')
        if (req.target !== null && !before.state.issuedNumbers.includes(req.target)) throw new ServiceError('TICKET_NOT_FOUND', '只能移入已发放的号码牌')
        const from = before.state.assignments[req.id] ?? null
        if (req.target !== from) {
          if (req.target === null) await conn.execute('DELETE FROM pickup_assignments WHERE person_id=?', [req.id])
          else await conn.execute('INSERT INTO pickup_assignments (person_id,ticket_number) VALUES (?,?) ON DUPLICATE KEY UPDATE ticket_number=?', [req.id,req.target,req.target])
          await conn.execute('UPDATE pickup_people SET assignment_version=assignment_version+1 WHERE id=?', [req.id])
        }
        changes.push({ id: req.id, from, to: req.target })
      }
      await conn.execute('UPDATE pickup_control SET revision=revision+1 WHERE id=1')
      await conn.execute('INSERT INTO pickup_requests (request_id,payload_hash,operation,result_json) VALUES (?,?,?,?)', [req.requestId,hash,req.operation,JSON.stringify(result)])
      await conn.execute('INSERT INTO pickup_audit (request_id,operation,changes_json) VALUES (?,?,?)', [req.requestId,req.operation,JSON.stringify(changes)])
      this.fault?.('before-commit')
      return { result, snapshot: await this.snapshotIn(conn), replayed: false }
    })
  }
}
