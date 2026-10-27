import { beforeEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import roster from '../../src/data/demo-roster.json'
import { DocumentSimulator } from '../../local-tools/docdb-simulator'
import { DocumentPickupService } from '../../cloudfunctions/pickup-docdb/service'
import { rosterHash } from '../../shared/server-validation'
import type { MutationRequest } from '../../shared/contracts'
import { createEmergencyExport, createExport, exportRows } from '../../src/services/export'
const hash = rosterHash(roster, 'demo-v1'), ids = roster.map(p=>p.id)
const request = (members: string[], requestId=randomUUID()): MutationRequest => ({operation:'register',requestId,rosterHash:hash,ids:members})
const correction = (id:string,target:number|null,expectedVersion:number): MutationRequest => ({operation:'correct',requestId:randomUUID(),rosterHash:hash,id,target,expectedVersion})
let db: DocumentSimulator, service: DocumentPickupService
beforeEach(async()=>{db=new DocumentSimulator();service=new DocumentPickupService(db,'pickup_docdb_test');await service.initialize(roster,'demo-v1',152,true)})

it('两个独立服务实例竞争同一人：仅一号、唯一归属，实际发生事务冲突',async()=>{
  const other=new DocumentPickupService(db,'pickup_docdb_test')
  const r=await Promise.all([service.mutate(request([ids[0]])),other.mutate(request([ids[0]]))])
  expect(r.filter(v=>v.result!.number===1)).toHaveLength(1)
  expect(r.find(v=>v.result!.number===null)!.result!.existing).toEqual([{id:ids[0],number:1}])
  expect((await service.snapshot()).state.issuedNumbers).toEqual([1]);expect(db.conflicts).toBeGreaterThan(0)
})
it('三个并发客户端登记不同人，按成功提交产生连续唯一号码',async()=>{
  const r=await Promise.all(ids.slice(0,3).map(id=>new DocumentPickupService(db,'pickup_docdb_test').mutate(request([id]))))
  expect(r.map(v=>v.result!.number).sort()).toEqual([1,2,3]);expect((await service.snapshot()).state.nextNumber).toBe(4)
})
it('并发交集、混合人员、全已分配不发号',async()=>{
  const r=await Promise.all([service.mutate(request(ids.slice(0,2))),service.mutate(request(ids.slice(1,3)))])
  expect(r.reduce((n,v)=>n+v.result!.newlyAssigned.length,0)).toBe(3)
  const mixed=await service.mutate(request([ids[0],ids[3]]))
  expect(mixed.result!.number).toBe(3);expect(mixed.result!.newlyAssigned).toEqual([ids[3]])
  const full=await service.mutate(request(ids.slice(0,4)))
  expect(full.result!.number).toBeNull();expect(full.snapshot.state.nextNumber).toBe(4)
})
it('同UUID并发三次、重新创建服务重试均返回原结果，不再发号；改变内容拒绝',async()=>{
  const req=request([ids[0]])
  const r=await Promise.all([service.mutate(req),service.mutate(req),service.mutate(req)])
  expect(r.map(v=>v.result!.number)).toEqual([1,1,1]);expect(r.filter(v=>v.replayed)).toHaveLength(2)
  const again=await new DocumentPickupService(db,'pickup_docdb_test').mutate(req)
  expect(again.replayed).toBe(true);expect(again.snapshot.state.nextNumber).toBe(2)
  await expect(service.mutate({...req,ids:[ids[1]]})).rejects.toMatchObject({code:'REQUEST_REUSED'})
})
it('模拟COMMIT成功应答丢失：返回不确定；原UUID安全恢复已提交结果',async()=>{
  db.loseCommitReply=true;const req=request([ids[0]])
  await expect(service.mutate(req)).rejects.toMatchObject({code:'RESULT_UNKNOWN',uncertain:true})
  const r=await service.mutate(req);expect(r.replayed).toBe(true);expect(r.result!.number).toBe(1)
  expect(r.snapshot.state.nextNumber).toBe(2)
})
it.each(['after-ticket','before-commit'])('%s失败全部回滚，号码与请求记录都不会残留',async point=>{
  const req=request([ids[0]]), failing=new DocumentPickupService(db,'pickup_docdb_test',p=>{if(p===point) throw new Error('injected')})
  await expect(failing.mutate(req)).rejects.toThrow('injected')
  expect((await service.snapshot()).state.nextNumber).toBe(1)
  expect(await db.get(service.dataCollection,'ticket:1')).toBeNull()
  expect(await db.get(service.requestsCollection,req.requestId)).toBeNull()
  expect((await service.mutate(req)).result!.number).toBe(1)
})
it('明确冲突最多重试两次；忙碌失败不发号且原请求可重试',async()=>{
  db.failCommits=3;const req=request([ids[0]])
  await expect(service.mutate(req)).rejects.toMatchObject({code:'TRANSACTION_BUSY',uncertain:true})
  expect(db.conflicts).toBe(3);expect((await service.snapshot()).state.nextNumber).toBe(1)
  expect((await service.mutate(req)).result!.number).toBe(1)
})
it('普通写失败不进行冲突重试',async()=>{
  db.failWrites=true
  await expect(service.mutate(request([ids[0]]))).rejects.toThrow('模拟写入失败')
  expect(db.conflicts).toBe(0);db.failWrites=false
  expect((await service.snapshot()).state.nextNumber).toBe(1)
})
it('并发纠正检测版本冲突，空号保留；重复纠正请求不重新执行',async()=>{
  await service.mutate(request([ids[0]]));await service.mutate(request([ids[1]]))
  const req=correction(ids[0],2,1)
  const r=await Promise.allSettled([service.mutate(req),service.mutate(correction(ids[0],null,1))])
  expect(r.filter(v=>v.status==='fulfilled')).toHaveLength(1)
  expect(r.find(v=>v.status==='rejected')).toMatchObject({reason:{code:'ASSIGNMENT_CONFLICT'}})
  const s=await service.snapshot()
  expect(s.state.issuedNumbers).toEqual([1,2]);expect(s.state.nextNumber).toBe(3)
  if(s.state.assignments[ids[0]]===2) expect((await service.mutate(req)).replayed).toBe(true)
})
it('纠正ABA也检测冲突，目标只能是已发号码',async()=>{
  await service.mutate(request([ids[0]]))
  await service.mutate(correction(ids[0],null,1));await service.mutate(correction(ids[0],1,2))
  await expect(service.mutate(correction(ids[0],null,1))).rejects.toMatchObject({code:'ASSIGNMENT_CONFLICT'})
  await expect(service.mutate(correction(ids[0],2,3))).rejects.toMatchObject({code:'TICKET_NOT_FOUND'})
})
it('拒绝空选择、未知ID和名单版本不一致，没有写入副作用',async()=>{
  await expect(service.mutate(request([]))).rejects.toMatchObject({code:'INVALID_PEOPLE'})
  await expect(service.mutate(request(['unknown']))).rejects.toMatchObject({code:'PERSON_NOT_FOUND'})
  await expect(service.mutate({...request([ids[0]]),rosterHash:'a'.repeat(64)})).rejects.toMatchObject({code:'ROSTER_CHANGED'})
  expect((await service.snapshot()).state.revision).toBe(0)
})
it('152人整批登记低于100事务操作；版本检查只读1文档，完整快照读6文档',async()=>{
  const r=await service.mutate(request(ids));expect(r.result!.newlyAssigned).toHaveLength(152)
  expect(Math.max(...db.operations)).toBeLessThanOrEqual(18)
  let reads=db.reads;await service.revision();expect(db.reads-reads).toBe(1)
  reads=db.reads;await service.snapshot();expect(db.reads-reads).toBe(6)
})
it('200人边界整批发号也低于100操作，读取与写入均按4个分块',async()=>{
  const people=Array.from({length:200},(_,i)=>({...roster[i%139],id:`demo-student-${String(i+1).padStart(3,'0')}`,name:`示例学员${String(i+1).padStart(3,'0')}`}))
  const local=new DocumentSimulator(), svc=new DocumentPickupService(local,'pickup_docdb_limit')
  await svc.initialize(people,'limit-v1',200,true)
  const r=await svc.mutate({operation:'register',requestId:randomUUID(),rosterHash:rosterHash(people,'limit-v1'),ids:people.map(p=>p.id)})
  expect(r.result!.newlyAssigned).toHaveLength(200);expect(Math.max(...local.operations)).toBeLessThanOrEqual(18)
})
it('并发快照保持整批一致，不会看到只有号码或部分人员的中间态',async()=>{
  await Promise.all([
    (async()=>{for(let i=0;i<12;i+=2) await service.mutate(request(ids.slice(i,i+2)))})(),
    (async()=>{for(let i=0;i<16;i++) {
      const s=await service.snapshot()
      expect(Object.keys(s.state.assignments).length).toBe(s.state.issuedNumbers.length*2)
      expect(s.state.nextNumber).toBe(s.state.issuedNumbers.length+1)
      for(const n of s.state.issuedNumbers) expect(Object.values(s.state.assignments).filter(v=>v===n)).toHaveLength(2)
    }})(),
  ])
})
it('初始化幂等，拒绝覆盖不同名单及超限，明确只接受虚构示例',async()=>{
  expect((await service.initialize(roster,'demo-v1',152,true)).reused).toBe(true)
  await expect(service.initialize(roster,'other',152,true)).rejects.toMatchObject({code:'ALREADY_INITIALIZED'})
  await expect(service.initialize(roster,'demo-v1',201,true)).rejects.toMatchObject({code:'ROSTER_LIMIT'})
  await expect(service.initialize([{...roster[0],name:'非示例记录'}],'demo-v1',1,true)).rejects.toMatchObject({code:'NOT_DEMO'})
})
it('磁盘模拟重启后归属、请求和空号仍保留（非真实云端持久化证据）',async()=>{
  const file=join(mkdtempSync(join(tmpdir(),'pickup-docdb-fake-')),'state.json')
  const first=new DocumentPickupService(new DocumentSimulator(file),'pickup_docdb_test')
  await first.initialize(roster,'demo-v1',152,true)
  const req=request([ids[0]]);await first.mutate(req);await first.mutate(correction(ids[0],null,1))
  const restarted=new DocumentPickupService(new DocumentSimulator(file),'pickup_docdb_test')
  const s=await restarted.snapshot();expect(s.state.assignments).toEqual({});expect(s.state.issuedNumbers).toEqual([1])
  const r=await restarted.mutate(req);expect(r.replayed).toBe(true);expect(r.result!.number).toBe(1);expect(r.snapshot.state.nextNumber).toBe(2)
})
it('两种Excel用同一一致快照，实际重读152人、分组、空号及最大号码',async()=>{
  await service.mutate(request([ids[0]]));await service.mutate(request([ids[1]]))
  await service.mutate(correction(ids[0],null,1));const s=await service.snapshot()
  const book=new ExcelJS.Workbook()
  await book.xlsx.load((await createExport(s.people,s.state,new Date(s.generatedAt),'服务端快照')).buffer)
  const sheet=book.getWorksheet('会场分组')!
  expect([1,2,3].map(c=>sheet.getRow(4).getCell(c).value)).toEqual(exportRows(s.people,s.state)[0])
  await book.xlsx.load((await createEmergencyExport(s.people,s.state,new Date(s.generatedAt),'服务端快照')).buffer)
  expect(book.getWorksheet('全部人员')!.rowCount).toBe(153)
  expect(book.getWorksheet('已发号码')!.getCell('B2').value).toBe(0)
  expect(book.getWorksheet('台账说明')!.getCell('B3').value).toBe('002')
})
