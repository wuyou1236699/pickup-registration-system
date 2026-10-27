import { createHash } from 'node:crypto'
import type { MutationRequest, Person } from './contracts'
import { ServiceError } from './service-error'

const ID = /^[A-Za-z0-9_-]{1,128}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function validateMutation(value: unknown): MutationRequest {
  if (!value || typeof value !== 'object') throw new ServiceError('INVALID_REQUEST', '请求格式不正确')
  const v = value as Record<string, unknown>
  if (typeof v.requestId !== 'string' || !UUID.test(v.requestId) || typeof v.rosterHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.rosterHash)) throw new ServiceError('INVALID_REQUEST', '请求标识或名单版本不正确')
  if (v.operation === 'register') {
    if (!Array.isArray(v.ids) || v.ids.length < 1 || v.ids.length > 200 || !v.ids.every(id => typeof id === 'string' && ID.test(id))) throw new ServiceError('INVALID_PEOPLE', '请选择 1 至 200 位有效人员')
    return { operation: 'register', requestId: v.requestId, rosterHash: v.rosterHash, ids: [...new Set(v.ids as string[])] }
  }
  if (v.operation === 'correct') {
    if (typeof v.id !== 'string' || !ID.test(v.id) || (v.target !== null && (!Number.isSafeInteger(v.target) || Number(v.target) < 1 || Number(v.target) > 999999)) || !Number.isSafeInteger(v.expectedVersion) || Number(v.expectedVersion) < 0) throw new ServiceError('INVALID_CORRECTION', '人员、号码或归属版本不正确')
    return { operation: 'correct', requestId: v.requestId, rosterHash: v.rosterHash, id: v.id, target: v.target as number | null, expectedVersion: v.expectedVersion as number }
  }
  throw new ServiceError('INVALID_OPERATION', '不支持此操作')
}
export function validateRoster(people: unknown, version: string, expectedCount: number): Person[] {
  if (!version || version.length > 128 || !Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > 10000 || !Array.isArray(people) || people.length !== expectedCount) throw new ServiceError('INVALID_ROSTER', '名单版本或人数不一致')
  const ids = new Set<string>()
  for (const value of people) {
    const p = value as Partial<Person> | null
    if (!p || typeof p.id !== 'string' || !ID.test(p.id) || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 128 || typeof p.company !== 'string' || p.company.length > 512 || !p.source || typeof p.source.sheet !== 'string' || typeof p.source.cell !== 'string' || typeof p.source.group !== 'string' || !Number.isInteger(p.source.row)) throw new ServiceError('INVALID_ROSTER', '名单存在缺失字段、重复 ID 或不合法记录')
    if (p.source.learningGroup !== undefined && (typeof p.source.learningGroup !== 'string' || p.source.learningGroup.length > 128)) throw new ServiceError('INVALID_ROSTER', '学习小组字段不合法')
    ids.add(p.id)
  }
  return people as Person[]
}
export function rosterHash(people: Person[], version: string): string {
  // MySQL JSON storage may reorder object keys. Hash an explicit canonical form.
  const records = people.map(p => ({ id:p.id,name:p.name,company:p.company,source:{sheet:p.source.sheet,row:p.source.row,cell:p.source.cell,group:p.source.group,...(p.source.learningGroup !== undefined ? {learningGroup:p.source.learningGroup} : {})} }))
  return createHash('sha256').update(JSON.stringify({ version, people:records })).digest('hex')
}
