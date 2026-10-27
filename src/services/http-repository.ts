import type { ApiResponse, MutationRequest, MutationResponse, RevisionInfo, ServiceSnapshot } from '../../shared/contracts'
import type { SharedPickupRepository } from './pickup-repository'

export class RepositoryError extends Error {
  constructor(public readonly code: string, message: string, public readonly uncertain = false) { super(message) }
}
export class HttpPickupRepository implements SharedPickupRepository {
  constructor(private readonly endpoint: string, private readonly timeout = 12000) {}
  protected async request(payload: { operation: 'snapshot' | 'revision' } | MutationRequest): Promise<ApiResponse & { ok: true }> {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), this.timeout)
    try {
      const response = await fetch(this.endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload), signal:abort.signal, cache:'no-store' })
      const raw: unknown = await response.json()
      if (!raw || typeof raw !== 'object' || !('ok' in raw) || typeof raw.ok !== 'boolean') throw new Error('无效响应')
      if (!raw.ok) {
        if (!('code' in raw) || typeof raw.code !== 'string' || !('message' in raw) || typeof raw.message !== 'string') throw new Error('无效错误响应')
        throw new RepositoryError(raw.code,raw.message,'uncertain' in raw && raw.uncertain === true)
      }
      if (!response.ok || !('data' in raw) || !raw.data || typeof raw.data !== 'object') throw new Error('无效响应')
      // Wire data is further checked when applying its snapshot; malformed successes
      // remain uncertain and cannot clear a saved mutation request.
      return raw as ApiResponse & { ok: true }
    } catch (error) {
      if (error instanceof RepositoryError) throw error
      const mutation=payload.operation==='register' || payload.operation==='correct'
      throw new RepositoryError('NETWORK_UNKNOWN', !mutation ? '无法获取最新名单，请检查网络后刷新' : '提交结果尚未确定，请恢复原请求结果，勿重新领取号码',mutation)
    } finally { clearTimeout(timer) }
  }
  async getSnapshot(): Promise<ServiceSnapshot> { const r = await this.request({operation:'snapshot'}); return validateSnapshot(r.data) }
  async getRevision(): Promise<RevisionInfo> {
    const r=await this.request({operation:'revision'}), v=r.data
    if(!('revision' in v) || !Number.isSafeInteger(v.revision) || v.revision<0 || !('rosterHash' in v) || typeof v.rosterHash!=='string' || !/^[a-f0-9]{64}$/.test(v.rosterHash) || !('generatedAt' in v) || typeof v.generatedAt!=='string' || !Number.isFinite(Date.parse(v.generatedAt))) throw new RepositoryError('INVALID_RESPONSE','版本检查响应不完整，请刷新名单')
    return {revision:v.revision,rosterHash:v.rosterHash,generatedAt:v.generatedAt}
  }
  async mutate(input: MutationRequest): Promise<MutationResponse> {
    const r = await this.request(input)
    if (!('snapshot' in r.data) || !('result' in r.data) || !('replayed' in r.data) || typeof r.data.replayed !== 'boolean') throw new RepositoryError('INVALID_RESPONSE','提交结果尚未确定，请恢复原请求',true)
    const snapshot = validateSnapshot(r.data.snapshot)
    const result = r.data.result
    if (input.operation === 'register') {
      const requested = new Set(input.ids)
      if (!result || !Array.isArray(result.newlyAssigned) || !Array.isArray(result.existing) || (result.number !== null && (!validNumber(result.number) || !snapshot.state.issuedNumbers.includes(result.number))) || result.newlyAssigned.some(id => typeof id !== 'string' || !requested.has(id)) || result.existing.some(p => !p || !requested.has(p.id) || !validNumber(p.number) || !snapshot.state.issuedNumbers.includes(p.number))) throw new RepositoryError('INVALID_RESPONSE','提交结果尚未确定，请恢复原请求',true)
      const returned = [...result.newlyAssigned,...result.existing.map(p=>p.id)]
      if (new Set(returned).size !== returned.length || returned.length !== requested.size || (result.number === null ? result.newlyAssigned.length !== 0 : result.newlyAssigned.length === 0)) throw new RepositoryError('INVALID_RESPONSE','提交结果尚未确定，请恢复原请求',true)
    } else if (result !== null) throw new RepositoryError('INVALID_RESPONSE','纠正结果尚未确定，请恢复原请求',true)
    return { result, snapshot, replayed:r.data.replayed }
  }
}
function validNumber(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value)>0 }
function record(value: unknown): value is Record<string,unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function validateSnapshot(value: unknown): ServiceSnapshot {
  if (!value || typeof value !== 'object' || !('people' in value) || !Array.isArray(value.people) || !('state' in value) || !value.state || typeof value.state !== 'object' || !('roster' in value) || !value.roster || typeof value.roster !== 'object' || !('generatedAt' in value) || typeof value.generatedAt !== 'string') throw new RepositoryError('INVALID_RESPONSE','服务器名单响应不完整，请重试',true)
  const s = value as ServiceSnapshot
  if (!s.people.every(p => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.company === 'string') || !record(s.state.assignments) || !Array.isArray(s.state.issuedNumbers) || !s.state.issuedNumbers.every(validNumber) || !record(s.state.versions) || !Number.isSafeInteger(s.state.revision) || Number(s.state.revision)<0 || !validNumber(s.state.nextNumber) || typeof s.roster.hash !== 'string' || !/^[a-f0-9]{64}$/.test(s.roster.hash) || typeof s.roster.demo !== 'boolean' || typeof s.roster.version !== 'string' || s.roster.count !== s.people.length || !Number.isFinite(Date.parse(s.generatedAt))) throw new RepositoryError('INVALID_RESPONSE','服务器名单响应不完整，请重试',true)
  const ids = new Set(s.people.map(p=>p.id)), numbers = new Set(s.state.issuedNumbers)
  if (ids.size !== s.people.length || numbers.size !== s.state.issuedNumbers.length || s.state.nextNumber !== Math.max(0,...numbers)+1 || s.people.some(p => !Number.isSafeInteger(s.state.versions![p.id]) || s.state.versions![p.id]<0) || Object.entries(s.state.assignments).some(([id,n])=>!ids.has(id) || !numbers.has(n))) throw new RepositoryError('INVALID_RESPONSE','服务器归属响应不一致，请重试',true)
  return s
}

export function pendingKey(endpoint: string) { return `pickup-pending-v2:${endpoint}` }
export function readPending(endpoint: string): MutationRequest | null {
  const raw = sessionStorage.getItem(pendingKey(endpoint))
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (record(v) && typeof v.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.requestId) && typeof v.rosterHash === 'string' && /^[a-f0-9]{64}$/.test(v.rosterHash)) {
      if (v.operation === 'register' && Array.isArray(v.ids) && v.ids.length>0 && v.ids.length<=200 && v.ids.every(id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) return v as unknown as MutationRequest
      if (v.operation === 'correct' && typeof v.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v.id) && (v.target === null || validNumber(v.target)) && Number.isSafeInteger(v.expectedVersion) && Number(v.expectedVersion)>=0) return v as unknown as MutationRequest
    }
  } catch { /* Do not erase a broken pending record; require manual investigation. */ }
  throw new RepositoryError('PENDING_CORRUPT','未完成请求记录无法读取，请联系负责人，暂勿重新发牌',true)
}
export function savePending(endpoint: string, request: MutationRequest) {
  // Must succeed before sending: otherwise a refresh could lose the only retry ID.
  try { sessionStorage.setItem(pendingKey(endpoint),JSON.stringify(request)) }
  catch { throw new RepositoryError('STORAGE_UNAVAILABLE','无法保存请求标识，尚未提交。请启用浏览器本地存储后重试') }
}
export function clearPending(endpoint: string) { sessionStorage.removeItem(pendingKey(endpoint)) }
