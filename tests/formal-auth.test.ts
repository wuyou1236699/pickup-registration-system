import { beforeEach, describe, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({ getSession: vi.fn(), signInWithPassword: vi.fn(), signInAnonymously: vi.fn(), signOut: vi.fn(), callFunction: vi.fn(), getUserInfo: vi.fn(), onAuthStateChange: vi.fn() }))
vi.mock('@cloudbase/node-sdk', () => ({ default: { SYMBOL_CURRENT_ENV: 'current', init: () => ({ auth: () => ({ getUserInfo: sdk.getUserInfo }) }) } }))
vi.mock('@cloudbase/js-sdk', () => ({ default: { init: () => ({ callFunction: sdk.callFunction, auth: sdk }) } }))
vi.mock('../cloudfunctions/pickup-docdb/web-entry', () => ({ main: vi.fn() }))
import { createFormalHandler, main } from '../cloudfunctions/pickup-docdb/formal-entry'
import { CloudBasePickupRepository } from '../src/services/cloudbase-repository'
const uids = ['fake-01', 'fake-02', 'fake-03', 'fake-04', 'fake-auditor']
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_CLOUDBASE_ENV_ID', 'fake-env')
  vi.stubEnv('VITE_CLOUDBASE_PUBLISHABLE_KEY', 'fake-public-key')
  sdk.getSession.mockResolvedValue({ data: { session: { user: { is_anonymous: false } } }, error: null })
  sdk.callFunction.mockResolvedValue({ result: { pickup: { ok: true, data: { authorized: true } } } })
  sdk.signInWithPassword.mockResolvedValue({ error: null })
  sdk.signOut.mockResolvedValue(undefined)
})
describe('formal server authorization', () => {
  it.each([{ uid: '', isAnonymous: false }, { uid: 'fake-01', isAnonymous: true }, { uid: 'other', isAnonymous: false }])('denies unauthenticated, anonymous and other users, including forged event UID: %j', async identity => {
    const business = vi.fn()
    const handler = createFormalHandler(() => identity, () => JSON.stringify(uids), business)
    for (const operation of ['authorize', 'snapshot', 'revision', 'register', 'correct']) {
      const result = await handler({ operation, uid: 'fake-01', context: { uid: 'fake-01' } })
      expect(result.pickup).toMatchObject({ ok: false })
    }
    expect(business).not.toHaveBeenCalled()
  })
  it.each(uids)('gives every approved UID the same business access: %s', async uid => {
    const business = vi.fn(async () => ({ pickup: { ok: true, data: {} } }))
    const handler = createFormalHandler(() => ({ uid, isAnonymous: false }), () => JSON.stringify(uids), business)
    expect(await handler({ operation: 'authorize' })).toEqual({ pickup: { ok: true, data: { authorized: true } } })
    for (const operation of ['snapshot', 'revision', 'register', 'correct']) await handler({ operation })
    expect(business).toHaveBeenCalledTimes(4)
  })
  it.each([undefined, '', '[]', '["fake-01"]', JSON.stringify([...uids.slice(0,4), 'fake-01'])])('fails closed for incomplete configuration: %s', async config => {
    const business = vi.fn()
    const handler = createFormalHandler(() => ({ uid: 'fake-01', isAnonymous: false }), () => config, business)
    expect((await handler({ operation: 'snapshot' })).pickup).toMatchObject({ code: 'AUTH_CONFIG_ERROR' })
    expect(business).not.toHaveBeenCalled()
  })
  it('production entry reads SDK context rather than event identity', async () => {
    vi.stubEnv('PICKUP_ALLOWED_UIDS', JSON.stringify(uids))
    sdk.getUserInfo.mockReturnValue({ uid: 'other', isAnonymous: false })
    expect((await main({ operation: 'authorize', uid: 'fake-01' })).pickup).toMatchObject({ code: 'ACCESS_DENIED' })
    expect(sdk.getUserInfo).toHaveBeenCalledOnce()
  })
  it('even approved users cannot call initialization or fault injection', async () => {
    const { main: realBusiness } = await vi.importActual<typeof import('../cloudfunctions/pickup-docdb/web-entry')>('../cloudfunctions/pickup-docdb/web-entry')
    const handler = createFormalHandler(() => ({ uid: 'fake-01', isAnonymous: false }), () => JSON.stringify(uids), realBusiness)
    for (const event of [{ trial: 'initialize' }, { operation: 'snapshot', trial: 'rollback' }, { operation: 'authorize', trial: 'initialize' }]) {
      expect((await handler(event)).pickup).toMatchObject({ code: 'INVALID_REQUEST' })
    }
  })
})
describe('formal browser authentication transport', () => {
  it.each([null, { user: { is_anonymous: true } }])('does not read or invoke anything without a password session: %j', async session => {
    sdk.getSession.mockResolvedValue({ data: { session }, error: null })
    const repository = new CloudBasePickupRepository('fake', true)
    expect(await repository.restoreAuthorization()).toBe(false)
    await expect(repository.getSnapshot()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(sdk.callFunction).not.toHaveBeenCalled()
    expect(sdk.signInAnonymously).not.toHaveBeenCalled()
  })
  it('restores via authorization only, without reading the roster', async () => {
    sdk.getSession.mockResolvedValue({ data: { session: { user: { is_anonymous: false, user_metadata: { username: 'auditor' } } } }, error: null })
    const repository = new CloudBasePickupRepository('fake', true)
    expect(await repository.restoreAuthorization()).toBe(true)
    expect(repository.currentUsername).toBe('auditor')
    expect(sdk.callFunction).toHaveBeenCalledExactlyOnceWith({ name: undefined, data: { operation: 'authorize' } })
  })
  it('uses built-in password login and logout; never sends passwords to business functions', async () => {
    const repository = new CloudBasePickupRepository('fake', true)
    await repository.login('staff01', 'fictional-test-password')
    expect(sdk.signInWithPassword).toHaveBeenCalledWith({ username: 'staff01', password: 'fictional-test-password' })
    expect(sdk.callFunction.mock.calls[0][0].data).toEqual({ operation: 'authorize' })
    sdk.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await repository.logout()
    expect(sdk.signOut).toHaveBeenCalledOnce()
  })
  it('does not claim logout success if the SDK still has a session', async () => {
    await expect(new CloudBasePickupRepository('fake', true).logout()).rejects.toMatchObject({ code: 'LOGOUT_FAILED' })
  })
  it('rejects an authenticated but unapproved user before roster reads', async () => {
    sdk.callFunction.mockResolvedValue({ result: { pickup: { ok: false, code: 'ACCESS_DENIED', message: '未授权' } } })
    const repository = new CloudBasePickupRepository('fake', true)
    repository.onAccessLost = vi.fn()
    await expect(repository.login('outsider', 'fictional-test-password')).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    expect(repository.onAccessLost).toHaveBeenCalledOnce()
    expect(sdk.callFunction.mock.calls.map(call => call[0].data.operation)).toEqual(['authorize'])
  })
  it('notifies the gate on session loss and unsubscribes on unmount', () => {
    const unsubscribe = vi.fn(), lost = vi.fn()
    sdk.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
    const cleanup = new CloudBasePickupRepository('fake', true).watchSession(lost)
    sdk.onAuthStateChange.mock.calls[0][0]('SIGNED_OUT', null)
    expect(lost).toHaveBeenCalledOnce()
    cleanup(); expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
