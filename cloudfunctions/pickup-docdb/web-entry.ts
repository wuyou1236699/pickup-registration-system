import { main as httpMain } from './index'

// Public Event entry uses the normal business handler only. Initialization and
// injected-fault trial commands are deliberately absent from this deployment.
export async function main(event: unknown) {
  if (!event || typeof event !== 'object' || !('operation' in event) ||
      !['snapshot', 'revision', 'register', 'correct'].includes(String(event.operation)) ||
      'trial' in event) {
    return { pickup: { ok: false, code: 'INVALID_REQUEST', message: '请求不正确' } }
  }
  const response = await httpMain({ httpMethod: 'POST', body: JSON.stringify(event) })
  // The Web SDK gateway interprets a top-level `code` as a platform error.
  // Keep business errors (including `uncertain`) inside the Event envelope.
  return { pickup: JSON.parse(response.body) as unknown }
}
