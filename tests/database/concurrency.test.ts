import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import ExcelJS from 'exceljs'
import { PickupService, rosterHash } from '../../cloudfunctions/pickup-api/service'
import { handleRequest } from '../../cloudfunctions/pickup-api/index'
import roster from '../../src/data/demo-roster.json'
import { createEmergencyExport, createExport, exportRows } from '../../src/services/export'
import { resetTestDatabase, testPool } from './fixture'
import type { MutationRequest } from '../../shared/contracts'
const pool = testPool('pickup_phase2_test')
const service = new PickupService(pool), hash = rosterHash(roster,'demo-v1')
const ids = roster.map(p=>p.id)
const request = (members: string[], requestId = randomUUID()): MutationRequest => ({operation:'register',requestId,rosterHash:hash,ids:members})
const correction = (id:string,target:number|null,expectedVersion:number): MutationRequest => ({operation:'correct',requestId:randomUUID(),rosterHash:hash,id,target,expectedVersion})
beforeEach(()=>resetTestDatabase(pool))
afterAll(()=>pool.end())
describe('真实 MySQL 事务 / 多连接竞争',()=>{
  it('两个客户端同时接同一人：一号唯一，后提交获得实际归属',async()=>{
    const [a,b] = await Promise.all([service.mutate(request([ids[0]])),service.mutate(request([ids[0]]))])
    expect([a.result!.number,b.result!.number].sort()).toEqual([1,null].sort())
    const s=await service.snapshot()
    expect(s.state.assignments).toEqual({[ids[0]]:1});expect(s.state.issuedNumbers).toEqual([1])
    expect([a,b].find(v=>v.result!.number===null)!.result!.existing).toEqual([{id:ids[0],number:1}])
  })
  it('三个客户端同时接不同人：按提交结果连续生成1、2、3',async()=>{
    const r=await Promise.all(ids.slice(0,3).map(id=>new PickupService(pool).mutate(request([id]))))
    expect(r.map(v=>v.result!.number).sort()).toEqual([1,2,3])
    const s=await service.snapshot();expect(s.state.nextNumber).toBe(4)
  })
  it('两批部分交集：共同人员不覆盖，其余未分配者获得各自新号',async()=>{
    const r=await Promise.all([service.mutate(request(ids.slice(0,2))),service.mutate(request(ids.slice(1,3)))])
    expect(r.map(v=>v.result!.number).sort()).toEqual([1,2])
    expect(r.reduce((n,v)=>n+v.result!.newlyAssigned.length,0)).toBe(3)
    expect(Object.keys((await service.snapshot()).state.assignments)).toHaveLength(3)
  })
  it('两批完全相同：只生成一个新号码',async()=>{
    const r=await Promise.all([service.mutate(request(ids.slice(0,3))),service.mutate(request(ids.slice(0,3)))])
    expect(r.filter(v=>v.result!.number!==null)).toHaveLength(1)
    expect((await service.snapshot()).state.issuedNumbers).toEqual([1])
  })
  it('同请求并发重复提交以及丢失响应后的重试：返回原结果且不再次发号',async()=>{
    const req=request([ids[0]])
    const r=await Promise.all([service.mutate(req),service.mutate(req),service.mutate(req)])
    expect(r.map(v=>v.result!.number)).toEqual([1,1,1]);expect(r.filter(v=>v.replayed)).toHaveLength(2)
    // Deliberately discard the first HTTP-style response and retry the identical request.
    const retried=await new PickupService(pool).mutate(req)
    expect(retried.replayed).toBe(true);expect(retried.result).toEqual(r[0].result)
    expect((await service.snapshot()).state.nextNumber).toBe(2)
    await expect(service.mutate({...req,ids:[ids[1]]})).rejects.toMatchObject({code:'REQUEST_REUSED'})
  })
  it('号码已生成但事务失败：票号、归属、请求和审计全部回滚，原ID可安全重试',async()=>{
    const failing=new PickupService(pool,point=>{if(point==='after-ticket') throw new Error('injected')})
    const req=request([ids[0]])
    await expect(failing.mutate(req)).rejects.toThrow('injected')
    let s=await service.snapshot();expect(s.state.issuedNumbers).toEqual([]);expect(s.state.assignments).toEqual({});expect(s.state.nextNumber).toBe(1)
    const [rows]=await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM pickup_requests)+(SELECT COUNT(*) FROM pickup_audit) AS count')
    expect(Number(rows[0].count)).toBe(0)
    expect((await service.mutate(req)).result!.number).toBe(1)
  })
  it('写完请求记录、提交前失败也回滚；重试请求不形成空号或假成功',async()=>{
    const req=request([ids[0]])
    await expect(new PickupService(pool,p=>{if(p==='before-commit')throw new Error('injected')}).mutate(req)).rejects.toThrow('injected')
    expect((await service.mutate(req)).result!.number).toBe(1)
  })
  it('数据库COMMIT成功但确认丢失：服务返回不确定，原请求恢复成功',async()=>{
    let injected=false
    const wrapped={getConnection:async()=>{
      const conn=await pool.getConnection(), commit=conn.commit.bind(conn)
      const release=conn.release.bind(conn)
      conn.commit=async()=>{
        await commit()
        if(!injected){injected=true;throw new Error('lost commit acknowledgement')}
      }
      conn.release=()=>{conn.commit=commit;conn.release=release;release()}
      return conn
    }} as Pool
    const req=request([ids[0]])
    await expect(new PickupService(wrapped).mutate(req)).rejects.toMatchObject({code:'RESULT_UNKNOWN',uncertain:true})
    const restored=await service.mutate(req)
    expect(restored.replayed).toBe(true);expect(restored.result!.number).toBe(1)
    expect(restored.snapshot.state.issuedNumbers).toEqual([1])
  })
  it('数据库持续锁冲突最多三次尝试，失败不遗留号码',async()=>{
    let attempts=0
    const wrapped={getConnection:async()=>{
      const conn=await pool.getConnection(),query=conn.query.bind(conn)
      const release=conn.release.bind(conn)
      conn.query=((...args:Parameters<typeof conn.query>)=>{
        if(String(args[0]).includes('FOR UPDATE')) {attempts++;return query("SIGNAL SQLSTATE 'HY000' SET MYSQL_ERRNO=1205, MESSAGE_TEXT='test lock timeout'")}
        return query(...args)
      }) as typeof conn.query
      conn.release=()=>{conn.query=query;conn.release=release;release()}
      return conn
    }} as Pool
    await expect(new PickupService(wrapped).mutate(request([ids[0]]))).rejects.toMatchObject({code:'ER_LOCK_WAIT_TIMEOUT'})
    expect(attempts).toBe(3);expect((await service.snapshot()).state.issuedNumbers).toEqual([])
  })
  it('MySQL注入实际死锁错误码后：回滚并有限重试',async()=>{
    // Real MySQL emits ER_LOCK_DEADLOCK via SIGNAL once before the work starts.
    // Intercept only the pool connection to inject this actual database error.
    let injected=false
    const wrapped = { getConnection:async()=>{
      const conn=await pool.getConnection(),query=conn.query.bind(conn)
      const release=conn.release.bind(conn)
      conn.query=((...args: Parameters<typeof conn.query>)=>{
        if(!injected && String(args[0]).includes('FOR UPDATE')) {injected=true;return query("SIGNAL SQLSTATE '40001' SET MYSQL_ERRNO=1213, MESSAGE_TEXT='test deadlock'")}
        return query(...args)
      }) as typeof conn.query
      conn.release=()=>{conn.query=query;conn.release=release;release()}
      return conn
    }} as Pool
    expect((await new PickupService(wrapped).mutate(request([ids[0]]))).result!.number).toBe(1)
    expect(injected).toBe(true)
  })
  it('已发号变为空组：新号不回收且纠正有审计',async()=>{
    await service.mutate(request([ids[0]]));await service.mutate(correction(ids[0],null,1))
    expect((await service.mutate(request([ids[1]]))).result!.number).toBe(2)
    const s=await service.snapshot();expect(s.state.issuedNumbers).toEqual([1,2])
    const [audit]=await pool.query<RowDataPacket[]>('SELECT operation FROM pickup_audit ORDER BY id')
    expect(audit.map(v=>v.operation)).toEqual(['register','correct','register'])
  })
  it('两个客户端同时纠正：一方成功、一方明确冲突，不静默覆盖（含ABA）',async()=>{
    await service.mutate(request([ids[0]]));await service.mutate(request([ids[1]]))
    const r=await Promise.allSettled([service.mutate(correction(ids[0],2,1)),service.mutate(correction(ids[0],null,1))])
    expect(r.filter(v=>v.status==='fulfilled')).toHaveLength(1)
    expect(r.find(v=>v.status==='rejected')).toMatchObject({reason:{code:'ASSIGNMENT_CONFLICT'}})
    const s=await service.snapshot()
    await service.mutate(correction(ids[0],1,s.state.versions![ids[0]]))
    await expect(service.mutate(correction(ids[0],2,1))).rejects.toMatchObject({code:'ASSIGNMENT_CONFLICT'})
  })
  it('纠正重复请求幂等：同一版本校验不会拒绝成功请求的恢复',async()=>{
    await service.mutate(request([ids[0]]))
    const req=correction(ids[0],null,1)
    await service.mutate(req)
    expect((await service.mutate(req)).replayed).toBe(true)
    expect((await service.snapshot()).state.versions![ids[0]]).toBe(2)
  })
  it('非法人员、号码、批量、请求ID、名单版本均拒绝且不发号',async()=>{
    await expect(service.mutate(request(['missing']))).rejects.toMatchObject({code:'PERSON_NOT_FOUND'})
    for(const n of [0,-1,1.2,9999999]) await expect(service.mutate(correction(ids[0],n,0))).rejects.toMatchObject({code:'INVALID_CORRECTION'})
    await expect(service.mutate(correction(ids[0],5,0))).rejects.toMatchObject({code:'TICKET_NOT_FOUND'})
    await expect(service.mutate(request([]))).rejects.toMatchObject({code:'INVALID_PEOPLE'})
    await expect(service.mutate(request(Array(201).fill(ids[0])))).rejects.toMatchObject({code:'INVALID_PEOPLE'})
    await expect(service.mutate({...request([ids[0]]),requestId:'not-a-uuid'})).rejects.toMatchObject({code:'INVALID_REQUEST'})
    await expect(service.mutate({...request([ids[0]]),rosterHash:'0'.repeat(64)})).rejects.toMatchObject({code:'ROSTER_CHANGED'})
    expect((await service.snapshot()).state.issuedNumbers).toEqual([])
  })
  it('重新创建服务仍读取持久化归属；导出快照和数据库一致',async()=>{
    await service.mutate(request([ids[0],ids[1]]));await service.mutate(request([ids[2]]));await service.mutate(correction(ids[2],null,1))
    const snapshot=await new PickupService(pool).snapshot()
    const venue=await createExport(snapshot.people,snapshot.state,new Date(snapshot.generatedAt),'服务端快照')
    const book=new ExcelJS.Workbook();await book.xlsx.load(venue.buffer)
    const actual: unknown[][]=[];book.getWorksheet('会场分组')!.eachRow((r,n)=>{if(n>=4)actual.push([1,2,3].map(col=>r.getCell(col).value))})
    expect(actual).toEqual(exportRows(snapshot.people,snapshot.state))
    const ledger=await createEmergencyExport(snapshot.people,snapshot.state,new Date(snapshot.generatedAt),'服务端快照')
    await book.xlsx.load(ledger.buffer)
    expect(book.getWorksheet('全部人员')!.rowCount).toBe(153)
    expect(book.getWorksheet('已发号码')!.getCell('A3').value).toBe('002')
    expect(book.getWorksheet('已发号码')!.getCell('B3').value).toBe(0)
    expect(book.getWorksheet('台账说明')!.getCell('B4').value).toBe('003')
    expect(book.getWorksheet('台账说明')!.getCell('B11').value).toContain('停止线上发号')
  })
  it('重复初始化保留登记；不同名单、重复ID、数量错误及真实数据冒充示例被拒绝',async()=>{
    await service.mutate(request([ids[0]]))
    expect((await service.initialize(roster,'demo-v1',152,true)).reused).toBe(true)
    await expect(service.initialize(roster,'demo-v2',152,true)).rejects.toMatchObject({code:'ALREADY_INITIALIZED'})
    await expect(service.initialize([...roster.slice(1),roster[1]],'x',152,true)).rejects.toMatchObject({code:'INVALID_ROSTER'})
    await expect(service.initialize(roster,'x',151,true)).rejects.toMatchObject({code:'INVALID_ROSTER'})
    await expect(service.initialize([{...roster[0],name:'非示例姓名'}],'x',1,true)).rejects.toMatchObject({code:'NOT_DEMO'})
    expect((await service.snapshot()).state.assignments[ids[0]]).toBe(1)
  })
  it('并发读取的快照始终整批一致，异常不返回SQL或隐私',async()=>{
    const [snapshot]=await Promise.all([service.snapshot(),service.mutate(request(ids.slice(0,3)))])
    const assigned=Object.keys(snapshot.state.assignments).length
    expect([0,3]).toContain(assigned);expect(snapshot.state.issuedNumbers.length).toBe(assigned ? 1 : 0)
    const outcome=await handleRequest(request([ids[4]]),new PickupService(pool,()=>{throw new Error('private sql name')}))
    expect(outcome).toMatchObject({ok:false,code:'DATABASE_UNAVAILABLE',uncertain:true})
    expect(JSON.stringify(outcome)).not.toContain('private sql name')
  })
})
