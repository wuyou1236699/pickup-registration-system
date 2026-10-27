import { describe, expect, it, vi } from 'vitest'
import type { ApiResponse } from '../shared/contracts'
import { main } from '../cloudfunctions/pickup-docdb/web-entry'
import { CloudBasePickupRepository } from '../src/services/cloudbase-repository'

const sdk = vi.hoisted(() => ({ callFunction: vi.fn(), getSession: vi.fn() }))
vi.mock('@cloudbase/js-sdk', () => ({ default: { init: () => ({ callFunction: sdk.callFunction, auth: { getSession: sdk.getSession } }) } }))
vi.mock('../cloudfunctions/pickup-docdb/index', () => ({ main: vi.fn(async () => ({ body: JSON.stringify({ ok:false,code:'ASSIGNMENT_CONFLICT',message:'此人员已被其他窗口修改',uncertain:false }) })) }))
class TestRepository extends CloudBasePickupRepository {
  send() { return this.request({ operation:'correct',requestId:'7ee567c1-666b-4dcd-b939-7a2b4c567764',rosterHash:'a'.repeat(64),id:'demo-student-104',target:13,expectedVersion:1 }) }
}
function setup(response: unknown) {
  vi.stubEnv('VITE_CLOUDBASE_ENV_ID','fake-env')
  vi.stubEnv('VITE_CLOUDBASE_PUBLISHABLE_KEY','public-test-key')
  sdk.getSession.mockResolvedValue({data:{session:{user:{is_anonymous:true}}},error:null})
  sdk.callFunction.mockImplementation(async () => {
    // Reproduce the gateway's top-level code handling.
    if(response && typeof response==='object' && 'code' in response) throw new Error('Gateway flattened business error')
    return {result:response}
  })
  return new TestRepository('cloudbase:fake-env:fake-function')
}
describe('CloudBase Event error envelope', () => {
  it('preserves a definite correction conflict instead of leaving an uncertain request', async () => {
    const response=await main({operation:'correct'})
    expect(response).not.toHaveProperty('code')
    await expect(setup(response).send()).rejects.toMatchObject({code:'ASSIGNMENT_CONFLICT',uncertain:false})
  })
  it('preserves uncertainty when a transaction must be recovered with the original UUID', async () => {
    const error:ApiResponse={ok:false,code:'TRANSACTION_BUSY',message:'请恢复原请求',uncertain:true}
    await expect(setup({pickup:error}).send()).rejects.toMatchObject({code:'TRANSACTION_BUSY',uncertain:true})
  })
  it('keeps actual network failures uncertain', async () => {
    const repository=setup(null)
    sdk.callFunction.mockRejectedValueOnce(new Error('network disconnected'))
    await expect(repository.send()).rejects.toMatchObject({code:'NETWORK_UNKNOWN',uncertain:true})
  })
  it('still denies initialization and fault injection without invoking the business handler', async () => {
    const {main:http}=await import('../cloudfunctions/pickup-docdb/index')
    vi.mocked(http).mockClear()
    for(const event of [{trial:'initialize'},{trial:'rollback'},{operation:'snapshot',trial:'initialize'}]) {
      expect(await main(event)).toEqual({pickup:{ok:false,code:'INVALID_REQUEST',message:'请求不正确'}})
    }
    expect(http).not.toHaveBeenCalled()
  })
})
