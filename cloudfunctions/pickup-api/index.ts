import { createDatabase } from './database'
import { PickupService } from './service'
import { handleRequest } from '../../shared/server-handler'
export { handleRequest } from '../../shared/server-handler'
let service: PickupService | undefined
export async function main(event: unknown) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  // Default closed. Enable only after the owner confirms gateway / network access protection.
  if (process.env.PICKUP_HTTP_ENABLED !== 'true') return { statusCode: 503, headers, body: JSON.stringify({ ok: false, code: 'ACCESS_NOT_CONFIGURED', message: '访问保护尚未配置' }) }
  if (!event || typeof event !== 'object' || !('httpMethod' in event) || event.httpMethod !== 'POST' || !('body' in event) || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 65536) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, code: 'INVALID_REQUEST', message: '请求不正确' }) }
  let body: unknown
  try { body = JSON.parse(event.body) } catch { return { statusCode: 400, headers, body: JSON.stringify({ ok: false, code: 'INVALID_JSON', message: '请求格式不正确' }) } }
  try { service ??= new PickupService(createDatabase()) }
  catch { return { statusCode: 503, headers, body: JSON.stringify({ ok: false, code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置', uncertain: true }) } }
  const response = await handleRequest(body, service)
  return { statusCode: response.ok ? 200 : response.uncertain ? 503 : 400, headers, body: JSON.stringify(response) }
}
