import cloudbase from '@cloudbase/node-sdk'
import { main as business } from './web-entry'

export function createFormalHandler(getIdentity: () => { uid?: string; isAnonymous?: boolean }, getConfig: () => string | undefined, handle = business) {
  return async (event: unknown) => {
    const deny = (code: string, message: string) => ({ pickup: { ok: false as const, code, message } })
    let allowed: unknown
    try { allowed = JSON.parse(getConfig() || '') } catch { return deny('AUTH_CONFIG_ERROR', '服务端授权尚未配置') }
    if (!Array.isArray(allowed) || allowed.length !== 5 || new Set(allowed).size !== 5 || allowed.some(uid => typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) return deny('AUTH_CONFIG_ERROR', '服务端授权尚未配置')
    let identity: ReturnType<typeof getIdentity>
    try { identity = getIdentity() } catch { return deny('AUTH_REQUIRED', '请登录后访问') }
    if (!identity.uid || identity.isAnonymous !== false) return deny('AUTH_REQUIRED', '请使用用户名和密码登录')
    if (!allowed.includes(identity.uid)) return deny('ACCESS_DENIED', '此账号未获接人系统授权')
    if (event && typeof event === 'object' && 'operation' in event && event.operation === 'authorize' && !('trial' in event)) return { pickup: { ok: true as const, data: { authorized: true } } }
    return handle(event)
  }
}

// UID is read from the SDK's platform context, never from event parameters.
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
export const main = createFormalHandler(() => app.auth().getUserInfo(), () => process.env.PICKUP_ALLOWED_UIDS)
