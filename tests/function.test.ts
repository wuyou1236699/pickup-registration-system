import { afterEach,expect,it,vi } from 'vitest'
import { main } from '../cloudfunctions/pickup-api/index'
afterEach(()=>vi.unstubAllEnvs())
it('未确认访问保护时云函数默认拒绝，响应不泄漏事件与运行密钥',async()=>{
  vi.stubEnv('PICKUP_HTTP_ENABLED','false')
  const result=await main({httpMethod:'POST',body:'{}',headers:{'x-cloudbase-context':'DO_NOT_ECHO'},secret:'DO_NOT_ECHO'})
  expect(result.statusCode).toBe(503);expect(JSON.stringify(result)).not.toContain('DO_NOT_ECHO')
})
it('云函数边界拒绝非法方法、格式和过大批量体',async()=>{
  vi.stubEnv('PICKUP_HTTP_ENABLED','true')
  for(const event of [{httpMethod:'GET',body:'{}'},{httpMethod:'POST',body:'not json'},{httpMethod:'POST',body:'x'.repeat(65537)}]) expect((await main(event)).statusCode).toBe(400)
})
