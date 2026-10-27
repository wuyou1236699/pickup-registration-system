import type { ApiResponse, MutationResponse, RevisionInfo, ServiceSnapshot } from './contracts'
import { ServiceError } from './service-error'
export interface BackendService {
  snapshot(): Promise<ServiceSnapshot>
  mutate(input: unknown): Promise<MutationResponse>
  revision?(): Promise<RevisionInfo>
}
export async function handleRequest(value: unknown, backend: BackendService): Promise<ApiResponse> {
  try {
    if (value && typeof value === 'object' && 'operation' in value) {
      if (value.operation === 'snapshot') return { ok: true, data: await backend.snapshot() }
      if (value.operation === 'revision' && backend.revision) return { ok: true, data: await backend.revision() }
    }
    return { ok: true, data: await backend.mutate(value) }
  } catch (error) {
    if (error instanceof ServiceError) return { ok: false, code: error.code, message: error.message, uncertain: error.uncertain }
    console.error(JSON.stringify({ event: 'pickup_error', code: 'DATABASE_UNAVAILABLE' }))
    return { ok: false, code: 'DATABASE_UNAVAILABLE', message: '服务暂时不可用；若正在提交，请保留原请求并恢复结果', uncertain: true }
  }
}
