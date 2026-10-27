/// <reference types="vite/client" />
import cloudbase from '@cloudbase/js-sdk'
import type { ApiResponse, MutationRequest } from '../../shared/contracts'
import { HttpPickupRepository, RepositoryError } from './http-repository'

// Reuse the existing snapshot validation, UUID recovery and mutation contracts.
// Only the transport changes from HTTP to a CloudBase Event function.
export class CloudBasePickupRepository extends HttpPickupRepository {
  private app?: ReturnType<typeof cloudbase.init>
  private authenticating?: Promise<void>
  currentUsername = ''
  onAccessLost?: () => void
  constructor(endpoint: string, private readonly formal = false) { super(endpoint) }

  private sdk() {
    const env = import.meta.env.VITE_CLOUDBASE_ENV_ID?.trim()
    const accessKey = import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY?.trim()
    if (!env || !accessKey) throw new RepositoryError('ACCESS_NOT_CONFIGURED', 'CloudBase 连接参数尚未配置')
    this.app ??= cloudbase.init({ env, accessKey, region: import.meta.env.VITE_CLOUDBASE_REGION || 'ap-shanghai' })
    return this.app
  }
  async restoreAuthorization() {
    this.currentUsername = ''
    const { data, error } = await this.sdk().auth.getSession()
    if (error) throw new RepositoryError('AUTH_REQUIRED', '会话已失效，请重新登录')
    if (!data?.session || data.session.user.is_anonymous) return false
    const response = await this.invoke({ operation: 'authorize' })
    if (!('authorized' in response.data) || response.data.authorized !== true) throw new RepositoryError('INVALID_RESPONSE', '授权响应不正确')
    const username: unknown = data.session.user.user_metadata?.username
    this.currentUsername = typeof username === 'string' ? username : ''
    return true
  }
  async login(username: string, password: string) {
    const { error } = await this.sdk().auth.signInWithPassword({ username, password })
    if (error) throw new RepositoryError('LOGIN_FAILED', '登录失败，请检查用户名和密码')
    if (!await this.restoreAuthorization()) throw new RepositoryError('AUTH_REQUIRED', '登录会话未建立')
  }
  async logout() {
    const response = await this.sdk().auth.signOut()
    if (response && typeof response === 'object' && 'error' in response && response.error) throw new RepositoryError('LOGOUT_FAILED', '退出未完成，请重试')
    const { data, error } = await this.sdk().auth.getSession()
    if (error || data?.session) throw new RepositoryError('LOGOUT_FAILED', '退出会话尚未确认，请重试')
    this.authenticating = undefined
    this.currentUsername = ''
  }
  watchSession(onLost: () => void) {
    this.onAccessLost = onLost
    const { data } = this.sdk().auth.onAuthStateChange((_event, session) => {
      if (!session || session.user.is_anonymous) onLost()
    })
    return () => { data.subscription.unsubscribe(); this.onAccessLost = undefined }
  }
  private async client() {
    const app = this.sdk()
    if (this.formal) {
      const { data, error } = await app.auth.getSession()
      if (error || !data?.session || data.session.user.is_anonymous) throw new RepositoryError('AUTH_REQUIRED', '请使用用户名和密码登录')
      return app
    }
    this.authenticating ??= (async () => {
      const { data, error } = await app.auth.getSession()
      if (error) throw error
      // This isolated trial contains only fake data. Use the environment's
      // already enabled anonymous provider; never change shared auth settings.
      if (!data?.session) {
        const { error: loginError } = await app.auth.signInAnonymously()
        if (loginError) throw loginError
        const { data: verified, error: sessionError } = await app.auth.getSession()
        if (sessionError) throw sessionError
        if (!verified?.session) throw new RepositoryError('AUTH_REQUIRED', '尚未建立 CloudBase 测试会话')
      }
    })().catch(error => { this.authenticating = undefined; throw error })
    await this.authenticating
    return app
  }

  protected override async request(payload: { operation: 'snapshot' | 'revision' } | MutationRequest): Promise<ApiResponse & { ok: true }> {
    return await this.invoke(payload) as ApiResponse & { ok: true }
  }
  private async invoke(payload: { operation: 'snapshot' | 'revision' | 'authorize' } | MutationRequest): Promise<{ ok: true; data: object }> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const mutation = payload.operation === 'register' || payload.operation === 'correct'
    try {
      const response = await Promise.race([
        (async () => {
          const app = await this.client()
          return app.callFunction({ name: import.meta.env.VITE_CLOUDBASE_PICKUP_FUNCTION, data: payload })
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('CloudBase request timed out')), 12000) }),
      ])
      const envelope: unknown = response.result
      if (!envelope || typeof envelope !== 'object' || !('pickup' in envelope)) throw new Error('无效 Event 响应')
      const raw: unknown = envelope.pickup
      if (!raw || typeof raw !== 'object' || !('ok' in raw) || typeof raw.ok !== 'boolean') throw new Error('无效响应')
      if (!raw.ok) {
        if (!('code' in raw) || typeof raw.code !== 'string' || !('message' in raw) || typeof raw.message !== 'string') throw new Error('无效错误响应')
        throw new RepositoryError(raw.code, raw.message, 'uncertain' in raw && raw.uncertain === true)
      }
      if (!('data' in raw) || !raw.data || typeof raw.data !== 'object') throw new Error('无效响应')
      return raw as ApiResponse & { ok: true }
    } catch (error) {
      if (this.formal && error instanceof RepositoryError && ['AUTH_REQUIRED', 'ACCESS_DENIED', 'AUTH_CONFIG_ERROR'].includes(error.code)) this.onAccessLost?.()
      if (error instanceof RepositoryError) throw error
      throw new RepositoryError('NETWORK_UNKNOWN', mutation ? '提交结果尚未确定，请恢复原请求结果，勿重新领取号码' : '无法读取 CloudBase 名单，请检查连接后刷新', mutation)
    } finally { if (timer) clearTimeout(timer) }
  }
}
