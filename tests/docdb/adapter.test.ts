import { expect, it, vi, afterEach } from 'vitest'
import cloudbase from '@cloudbase/node-sdk'
import { adaptDatabase } from '../../cloudfunctions/pickup-docdb/database'
import { main } from '../../cloudfunctions/pickup-docdb/index'
type NativeDb=ReturnType<ReturnType<typeof cloudbase.init>['database']>
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
function native(get:unknown, commit:unknown={}) {
  const set=vi.fn(async()=>({})), rollback=vi.fn(async()=>({}))
  const collection=vi.fn(()=>({doc:vi.fn(()=>({get:async()=>get,set}))}))
  const startTransaction=async()=>({collection,commit:async()=>commit,rollback})
  return {db:{collection,startTransaction} as unknown as NativeDb,set,rollback}
}
it('按官方SDK3.18.3直接set文档并规范化事务对象、非事务数组结果',async()=>{
  const a=native({data:{_id:'id',x:1}}),tx=await adaptDatabase(a.db).startTransaction()
  const read=await tx.get('data','id');expect(read).toEqual({_id:'id',x:1})
  await tx.set('data','id',{...read as object,x:2})
  expect(a.set).toHaveBeenCalledWith({x:2})
  expect(await adaptDatabase(native({data:[{x:1}]}).db).get('data','id')).toEqual({x:1})
})
it('SDK返回code而非throw时仍正确抛出冲突，空文档结果正常',async()=>{
  const tx=await adaptDatabase(native({data:null},{code:'DATABASE_TRANSACTION_CONFLICT'}).db).startTransaction()
  await expect(tx.commit()).rejects.toMatchObject({code:'DATABASE_TRANSACTION_CONFLICT'})
  expect(await adaptDatabase(native({code:'DOCUMENT_NOT_FOUND'}).db).get('data','id')).toBeNull()
  await expect(adaptDatabase(native({code:'DATABASE_PERMISSION_DENIED'}).db).get('data','id')).rejects.toMatchObject({code:'DATABASE_PERMISSION_DENIED'})
})
it('默认关闭全部调用，不尝试初始化云数据库',async()=>{
  vi.stubEnv('PICKUP_DOCDB_HTTP_ENABLED','false');const spy=vi.spyOn(cloudbase,'init')
  expect(JSON.parse((await main({httpMethod:'POST',body:'{}'})).body).code).toBe('ACCESS_NOT_CONFIGURED')
  expect(spy).not.toHaveBeenCalled()
})
it('启用标志不能绕过格式校验，未配置环境时失败并且不回退本地模拟',async()=>{
  vi.stubEnv('PICKUP_DOCDB_HTTP_ENABLED','true');vi.stubEnv('PICKUP_DOCDB_ENV','')
  expect((await main({operation:'snapshot'})).statusCode).toBe(400)
  expect((await main({httpMethod:'POST',body:'not json'})).statusCode).toBe(400)
  expect(JSON.parse((await main({httpMethod:'POST',body:'{"operation":"snapshot"}'})).body).code).toBe('DATABASE_NOT_CONFIGURED')
})
