import { it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import roster from '../src/data/demo-roster.json'
import { emptyState, register, correctAssignment } from '../src/domain/pickup'
import { createExport, createEmergencyExport, exportRows } from '../src/services/export'
it('实际写出并重读 Excel：仅已分配、排序、号码保留前导零、时间正确', async () => {
  const a=register(emptyState(),[roster[3].id,roster[1].id],roster)
  const b=register(a.state,[roster[0].id],roster)
  const c=correctAssignment(b.state,roster[1].id,2,roster)
  const d=correctAssignment(c,roster[3].id,null,roster)
  const {buffer,filename}=await createExport(roster,d,new Date('2026-10-09T01:00:00Z'))
  const workbook=new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet=workbook.getWorksheet('会场分组')!
  expect(sheet.rowCount).toBe(5)
  expect(sheet.getCell('A2').value).toContain('2026-10-09 09:00:00')
  expect(filename).toContain('20261009090000')
  const values=[4,5].map(n=>[1,2,3].map(col=>sheet.getRow(n).getCell(col).value))
  expect(values).toEqual(exportRows(roster,d))
  expect(values.map(row=>row[0])).toEqual(['002','002'])
  expect(sheet.getCell('A5').isMerged).toBe(true)
  expect(sheet.getCell('A5').master.address).toBe('A4')
})

it('会场号码按组纵向合并、居中，相邻组白绿交替且保留每个人姓名公司',async()=>{
  const state={...emptyState(),assignments:{[roster[0].id]:2,[roster[1].id]:2,[roster[2].id]:4,[roster[3].id]:5,[roster[4].id]:5}}
  const before=JSON.stringify(state)
  const {buffer}=await createExport(roster,state)
  const workbook=new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet=workbook.getWorksheet('会场分组')!
  expect(sheet.getCell('A5').master.address).toBe('A4')
  expect(sheet.getCell('A6').isMerged).toBe(false)
  expect(sheet.getCell('A8').master.address).toBe('A7')
  for(const address of ['A4','A6','A7']) expect(sheet.getCell(address).alignment).toMatchObject({horizontal:'center',vertical:'middle'})
  for(let i=0;i<5;i++) {
    expect(sheet.getCell(i+4,2).value).toBe(roster[i].name)
    expect(sheet.getCell(i+4,3).value).toBe(roster[i].company)
    const expected=i<2||i>2?'FFF0F8F5':'FFFFFFFF'
    for(let col=1;col<=3;col++) expect(sheet.getCell(i+4,col).fill).toMatchObject({fgColor:{argb:expected}})
  }
  expect(JSON.stringify(state)).toBe(before)
  for(let row=3;row<=8;row++) {
    for(let col=1;col<=3;col++) {
      const border=sheet.getCell(row,col).border
      for(const side of ['top','bottom','left','right'] as const) expect(border[side]).toMatchObject({style:'thin',color:{argb:'FF9CB5AC'}})
    }
  }
})

it('应急台账包含全部152人、当前归属、全部已发号及空号，最大号不按现有人数回退', async () => {
  const a=register(emptyState(),[roster[0].id,roster[1].id],roster)
  const b=register(a.state,[roster[2].id],roster)
  const c=correctAssignment(b.state,roster[2].id,null,roster)
  const snapshot=JSON.stringify(c)
  const {buffer,filename}=await createEmergencyExport(roster,c,new Date('2026-10-09T01:00:00Z'))
  const workbook=new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  expect(workbook.worksheets.map(s=>s.name)).toEqual(['台账说明','全部人员','已发号码'])
  const all=workbook.getWorksheet('全部人员')!
  expect(all.rowCount).toBe(153)
  roster.forEach((p,index)=>{
    const row=all.getRow(index+2)
    expect([1,2,3,4].map(col=>row.getCell(col).value)).toEqual([index+1,p.name,p.company,c.assignments[p.id]===undefined?'未分配':String(c.assignments[p.id]).padStart(3,'0')])
    expect(row.getCell(5).value).toBe('')
  })
  const numbers=workbook.getWorksheet('已发号码')!
  expect(numbers.rowCount).toBe(3)
  expect([1,2,3].map(col=>numbers.getRow(2).getCell(col).value)).toEqual(['001',2,'已发放'])
  expect([1,2,3].map(col=>numbers.getRow(3).getCell(col).value)).toEqual(['002',0,'已发放（当前空号）'])
  const notes=workbook.getWorksheet('台账说明')!
  expect(notes.getCell('B2').value).toBe('2026-10-09 09:00:00')
  expect(notes.getCell('B3').value).toBe('002')
  expect(notes.getCell('B4').value).toBe('003')
  expect(filename).toBe('应急台账_本地模拟_20261009090000.xlsx')
  expect(JSON.stringify(c)).toBe(snapshot)
})

it('未发号码也可导出完整应急台账，人工从001开始',async()=>{
  const {buffer}=await createEmergencyExport(roster,emptyState())
  const workbook=new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  expect(workbook.getWorksheet('全部人员')!.rowCount).toBe(153)
  expect(workbook.getWorksheet('已发号码')!.rowCount).toBe(1)
  expect(workbook.getWorksheet('台账说明')!.getCell('B3').value).toBe('无')
  expect(workbook.getWorksheet('台账说明')!.getCell('B4').value).toBe('001')
})
