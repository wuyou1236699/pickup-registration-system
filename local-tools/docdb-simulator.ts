import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DocumentDatabase, DocumentTransaction } from '../cloudfunctions/pickup-docdb/port'

interface RecordValue { version: number; data: object }
const copy = <T>(v: T): T => structuredClone(v)
const conflict = () => Object.assign(new Error('模拟文档写冲突'), { code: 'DATABASE_TRANSACTION_CONFLICT' })

/** Local MVCC simulator ONLY. Does not prove CloudBase isolation or billing. */
export class DocumentSimulator implements DocumentDatabase {
  private records = new Map<string, RecordValue>()
  readonly operations: number[] = []
  reads = 0
  conflicts = 0
  failCommits = 0
  loseCommitReply = false
  failWrites = false
  constructor(private readonly file?: string) {
    if (file && existsSync(file)) this.records = new Map(JSON.parse(readFileSync(file, 'utf8')))
  }
  private key(collection: string, id: string) { return `${collection}/${id}` }
  async get(collection: string, id: string) {
    this.reads++; return copy(this.records.get(this.key(collection, id))?.data ?? null)
  }
  async startTransaction(): Promise<DocumentTransaction> {
    const view = copy(this.records), writes = new Map<string, object>(), started = Date.now()
    let active = true, operations = 0
    const use = () => {
      if (!active) throw new Error('事务已经结束')
      if (++operations > 100 || Date.now() - started > 30000) throw new Error('模拟事务限制')
    }
    return {
      get: async (collection, id) => {
        use(); this.reads++
        const key = this.key(collection, id)
        return copy(writes.get(key) ?? view.get(key)?.data ?? null)
      },
      set: async (collection, id, data) => {
        use()
        if (this.failWrites) throw new Error('模拟写入失败')
        if (Buffer.byteLength(JSON.stringify(data)) > 512 * 1024) throw new Error('模拟文档大小限制')
        writes.set(this.key(collection, id), copy(data))
      },
      commit: async () => {
        use(); this.operations.push(operations)
        if (this.failCommits > 0) { this.failCommits--; this.conflicts++; active = false; throw conflict() }
        for (const key of writes.keys()) {
          if (this.records.get(key)?.version !== view.get(key)?.version) {
            this.conflicts++; active = false; throw conflict()
          }
        }
        const next = copy(this.records)
        for (const [key, data] of writes) next.set(key, {version: (next.get(key)?.version ?? 0) + 1, data})
        // Commit to disk first; publish the complete state only after a successful rename.
        if (this.file && writes.size) {
          mkdirSync(dirname(this.file), {recursive: true})
          writeFileSync(`${this.file}.tmp`, JSON.stringify([...next]))
          renameSync(`${this.file}.tmp`, this.file)
        }
        this.records = next; active = false
        if (this.loseCommitReply && writes.size) { this.loseCommitReply = false; throw new Error('模拟提交应答丢失') }
      },
      rollback: async () => { active = false },
    }
  }
}
