import { expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { createHash, randomUUID } from 'node:crypto'
import { parseFormalRoster } from '../scripts/parse-formal-roster.mjs'
import roster from '../src/data/demo-roster.json'
import { rosterHash, validateRoster } from '../shared/server-validation'
import { DocumentPickupService } from '../cloudfunctions/pickup-docdb/service'
import { DocumentSimulator } from '../local-tools/docdb-simulator'
import { createExport, createEmergencyExport } from '../src/services/export'
import { emptyState, register } from '../src/domain/pickup'

function workbook() {
  const w = new ExcelJS.Workbook(), s = w.addWorksheet('总名单')
  s.addRows([['序号','姓名','学习小组','企业名称（发票抬头）'],[1,'虚构人员甲',{formula:'VLOOKUP(B2,Source!A:C,3,FALSE)',result:'示例学习组甲'},'虚构企业甲'],[2,'虚构人员乙',{formula:'VLOOKUP(B3,Source!A:C,3,FALSE)',result:0},'虚构企业乙'],[3,'虚构人员甲','','虚构企业丙']])
  return w
}
it('学习小组按同一行缓存对应，空白不继承，同名人员保留独立稳定 ID', () => {
  const w=workbook(), before=JSON.stringify(w.model)
  const {people}=parseFormalRoster(w)
  expect(people.map(p=>p.source.learningGroup)).toEqual(['示例学习组甲','',''])
  expect(people).toHaveLength(3)
  expect(new Set(people.map(p=>p.id)).size).toBe(3)
  expect(parseFormalRoster(w).people).toEqual(people)
  expect(JSON.stringify(w.model)).toBe(before)
  expect(()=>parseFormalRoster(w,['虚构人员甲'])).toThrow('不能唯一对应')
})
it('没有缓存、错误值、合并小组或未知表结构均停止，不猜测', () => {
  for(const value of [{formula:'Missing()'},{formula:'Missing()',result:{error:'#N/A'}},17]){
    const w=workbook();w.worksheets[0].getCell('C2').value=value as ExcelJS.CellValue
    expect(()=>parseFormalRoster(w)).toThrow()
  }
  const merged=workbook();merged.worksheets[0].mergeCells('C2:C3');expect(()=>parseFormalRoster(merged)).toThrow('合并')
  const changed=workbook();changed.worksheets[0].getCell('C1').value='未知列';expect(()=>parseFormalRoster(changed)).toThrow('结构不匹配')
})
it('保留原企业并按独立配置标注志工，不更改小组或记录数量',()=>{
  const {people}=parseFormalRoster(workbook(),['虚构人员乙'])
  expect(people[1].company).toBe('虚构企业乙（志工）')
  expect(people[1].source.learningGroup).toBe('')
  expect(people).toHaveLength(3)
})
it('旧名单哈希完全兼容，新小组进入完整性校验，非法类型拒绝',()=>{
  const records=roster.map(p=>({id:p.id,name:p.name,company:p.company,source:{sheet:p.source.sheet,row:p.source.row,cell:p.source.cell,group:p.source.group}}))
  const old=createHash('sha256').update(JSON.stringify({version:'demo-v1',people:records})).digest('hex')
  expect(rosterHash(records,'demo-v1')).toBe(old)
  const next=structuredClone(records);Object.assign(next[0].source,{learningGroup:'示例学习组甲'})
  expect(rosterHash(next,'demo-v1')).not.toBe(old)
  expect(validateRoster(next,'demo-v1',152)).toEqual(next)
  Object.assign(next[0].source,{learningGroup:1});expect(()=>validateRoster(next,'demo-v1',152)).toThrow()
})
it('本地文档事务保留小组字段，登记、重复UUID和纠正保持原逻辑',async()=>{
  const people=roster.map((p,i)=>({...p,source:{...p.source,learningGroup:i===0?'示例学习组甲':''}}))
  const service=new DocumentPickupService(new DocumentSimulator(),'pickup_docdb_group_test')
  await service.initialize(people,'group-demo',152,true)
  const snapshot=await service.snapshot()
  const req={operation:'register',requestId:randomUUID(),rosterHash:snapshot.roster.hash,ids:people.slice(0,2).map(p=>p.id)}
  const first=await service.mutate(req), repeated=await service.mutate(req)
  expect(first.result?.number).toBe(1);expect(repeated.result).toEqual(first.result)
  const corrected=await service.mutate({operation:'correct',requestId:randomUUID(),rosterHash:snapshot.roster.hash,id:people[0].id,target:null,expectedVersion:first.snapshot.state.versions![people[0].id]})
  expect(corrected.snapshot.people).toEqual(people)
  expect(corrected.snapshot.state.assignments[people[0].id]).toBeUndefined()
  expect(corrected.snapshot.state.assignments[people[1].id]).toBe(1)
  expect(corrected.snapshot.state.nextNumber).toBe(2)
})
it('两种实际Excel导出：增加学习小组前后所有表内容和格式一致',async()=>{
  const grouped=roster.map((p,i)=>({...p,source:{...p.source,learningGroup:i===0?'只用于登记核对的小组':''}}))
  const state=register(emptyState(),roster.slice(0,3).map(p=>p.id),roster).state,date=new Date('2026-10-10T01:00:00Z')
  for(const exportFn of [createExport,createEmergencyExport]){
    const old=await exportFn(roster,state,date),next=await exportFn(grouped,state,date)
    expect(next.filename).toBe(old.filename)
    const a=new ExcelJS.Workbook(),b=new ExcelJS.Workbook();await a.xlsx.load(old.buffer);await b.xlsx.load(next.buffer)
    expect(b.model).toEqual(a.model)
    expect(JSON.stringify(b.model)).not.toContain('只用于登记核对的小组')
  }
})
