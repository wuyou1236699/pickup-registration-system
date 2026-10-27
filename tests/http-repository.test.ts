import { afterEach,expect,it,vi } from 'vitest'
import { HttpPickupRepository,RepositoryError } from '../src/services/http-repository'
import { emptyState } from '../src/domain/pickup'
import roster from '../src/data/demo-roster.json'
const snapshot={people:roster,state:{...emptyState(),issuedNumbers:[1],nextNumber:2,assignments:{[roster[0].id]:1},versions:Object.fromEntries(roster.map(p=>[p.id,p===roster[0]?1:0])),revision:1},roster:{version:'demo-v1',hash:'f'.repeat(64),count:152,demo:true},generatedAt:'2026-10-09T00:00:00Z'}
const request={operation:'register' as const,requestId:'84a3c6c0-0562-4b9f-bc9f-fcc3bd8bb88f',rosterHash:snapshot.roster.hash,ids:[roster[0].id]}
afterEach(()=>vi.unstubAllGlobals())
it('超时中止请求且判定结果未知；相同请求重试沿用ID',async()=>{
  const payloads:string[]=[]
  vi.stubGlobal('fetch',vi.fn((_url,init:RequestInit)=>{
    payloads.push(String(init.body))
    if(payloads.length===1) return new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new Error('timeout'))))
    return Promise.resolve(new Response(JSON.stringify({ok:true,data:{snapshot,result:{number:1,newlyAssigned:request.ids,existing:[]},replayed:true}})))
  }))
  const repo=new HttpPickupRepository('/api/pickup',5)
  await expect(repo.mutate(request)).rejects.toMatchObject({uncertain:true,code:'NETWORK_UNKNOWN'})
  expect((await repo.mutate(request)).replayed).toBe(true);expect(payloads[0]).toBe(payloads[1])
})
it('明确的纠正冲突和不确定服务异常分别处理',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ok:false,code:'ASSIGNMENT_CONFLICT',message:'其他人已修改'}),{status:400})).mockResolvedValueOnce(new Response(JSON.stringify({ok:false,code:'RESULT_UNKNOWN',message:'结果尚未确定',uncertain:true}),{status:503})))
  const repo=new HttpPickupRepository('/api/pickup')
  await expect(repo.mutate(request)).rejects.toMatchObject({uncertain:false,code:'ASSIGNMENT_CONFLICT'})
  await expect(repo.mutate(request)).rejects.toMatchObject({uncertain:true,code:'RESULT_UNKNOWN'})
})
it('无效成功响应不能被当作完成；快照响应须完整',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ok:true,data:{}}))).mockResolvedValueOnce(new Response(JSON.stringify({ok:true,data:{snapshot,result:{number:1},replayed:false}}))))
  const repo=new HttpPickupRepository('/api/pickup')
  await expect(repo.getSnapshot()).rejects.toBeInstanceOf(RepositoryError)
  await expect(repo.mutate(request)).rejects.toMatchObject({uncertain:true})
})
it('轻量版本检查校验返回值；查询超时不被判定为未确定写操作',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ok:true,data:{revision:3,rosterHash:snapshot.roster.hash,generatedAt:snapshot.generatedAt}}))).mockResolvedValueOnce(new Response(JSON.stringify({ok:true,data:{revision:-1}}))))
  const repo=new HttpPickupRepository('/api/pickup',5)
  expect((await repo.getRevision()).revision).toBe(3)
  await expect(repo.getRevision()).rejects.toMatchObject({uncertain:false})
  vi.stubGlobal('fetch',vi.fn((_url,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new Error('timeout'))))))
  await expect(repo.getRevision()).rejects.toMatchObject({uncertain:false})
})
