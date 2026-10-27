import { test,expect,type Page,type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import roster from '../../src/data/demo-roster.json' with {type:'json'}
import type { ServiceSnapshot } from '../../shared/contracts'
async function snapshot(api:APIRequestContext):Promise<ServiceSnapshot> {return (await (await api.post('/api/pickup',{data:{operation:'snapshot'}})).json()).data}
async function add(page:Page,index:number) {
  const input=page.getByRole('combobox');await expect(input).toBeEnabled();await input.fill(roster[index].name);await input.press('Enter')
  await expect(page.locator('.selected-person')).toContainText(roster[index].name)
}
test('两个独立窗口竞争，鼠标/键盘登记，刷新保留归属和模拟标识',async({page,browser,request})=>{
  const before=await snapshot(request),number=before.state.nextNumber,idx=roster.findIndex(p=>before.state.assignments[p.id]===undefined)
  const context=await browser.newContext(),other=await context.newPage()
  await Promise.all([page.goto('/'),other.goto('/')])
  await expect(page.locator('.local-badge')).toContainText('文档库本地模拟')
  await page.getByRole('combobox').press('Enter');await expect(page.locator('.selected-person')).toHaveCount(0)
  await Promise.all([add(page,idx),add(other,idx)])
  await Promise.all([page.getByRole('button',{name:'确认登记'}).click(),other.getByRole('combobox').press('Control+Enter')])
  await expect(page.locator('.result-panel')).toBeVisible();await expect(other.locator('.result-panel')).toBeVisible()
  expect([...(await page.locator('.big-ticket strong').allTextContents()),...(await other.locator('.big-ticket strong').allTextContents())]).toEqual([String(number).padStart(3,'0')])
  const after=await snapshot(request);expect(after.state.nextNumber).toBe(number+1)
  await page.reload();await add(page,idx);await expect(page.locator('.selection-panel')).toContainText(`已有 ${String(number).padStart(3,'0')} 号`)
  await context.close()
})
test('版本未变只检查revision，其他窗口登记后及时拉取完整快照',async({page,request})=>{
  const counts={revision:0,snapshot:0}
  page.on('request',req=>{if(req.url().endsWith('/api/pickup')) {const op:unknown=req.postDataJSON()?.operation;if(op==='revision'||op==='snapshot')counts[op]++}})
  await page.goto('/manage');await expect(page.locator('.table-summary')).toContainText('152')
  // Development React StrictMode may issue two initial requests. Count steady state.
  const initialSnapshots=counts.snapshot
  await expect.poll(()=>counts.revision,{timeout:12000}).toBeGreaterThanOrEqual(2)
  expect(counts.snapshot).toBe(initialSnapshots)
  const s=await snapshot(request),person=s.people.find(p=>s.state.assignments[p.id]===undefined)!
  const response=await request.post('/api/pickup',{data:{operation:'register',requestId:randomUUID(),rosterHash:s.roster.hash,ids:[person.id]}})
  expect((await response.json()).ok).toBe(true)
  await expect(page.getByRole('row').filter({hasText:person.name})).toContainText(`${String(s.state.nextNumber).padStart(3,'0')} 号`,{timeout:9000})
  expect(counts.snapshot).toBe(initialSnapshots+1)
})
test('提交应答丢失后刷新，原UUID恢复、不重复发牌',async({page,request})=>{
  const before=await snapshot(request),idx=roster.findIndex(p=>before.state.assignments[p.id]===undefined),sent:string[]=[]
  let lost=false
  await page.route('**/api/pickup',async route=>{
    const body=route.request().postDataJSON()
    if(body.operation==='register') {sent.push(body.requestId);if(!lost){lost=true;await route.fetch();await route.abort('failed');return}}
    await route.continue()
  })
  await page.goto('/');await add(page,idx);await page.getByRole('button',{name:'确认登记'}).click()
  await expect(page.getByRole('button',{name:'恢复原请求结果'})).toBeVisible()
  await page.reload();await page.getByRole('button',{name:'恢复原请求结果'}).click()
  await expect(page.locator('.big-ticket strong')).toHaveText(String(before.state.nextNumber).padStart(3,'0'))
  expect(sent).toHaveLength(2);expect(sent[0]).toBe(sent[1])
  expect((await snapshot(request)).state.nextNumber).toBe(before.state.nextNumber+1)
})
test('双窗口纠正冲突，Excel实际下载与最新快照一致，包括空号',async({page,browser,request})=>{
  const before=await snapshot(request),p=before.people.find(p=>before.state.assignments[p.id]!==undefined)!
  const context=await browser.newContext(),other=await context.newPage()
  await Promise.all([page.goto('/manage'),other.goto('/manage')])
  const row=page.getByRole('row').filter({hasText:p.name}),otherRow=other.getByRole('row').filter({hasText:p.name})
  await row.getByRole('button').click();await otherRow.getByRole('button').click()
  await page.getByLabel('纠正后的号码').selectOption('unassigned');await page.getByRole('button',{name:'保存纠正'}).click()
  await expect(row).toContainText('未分配')
  await other.getByRole('button',{name:'保存纠正'}).click();await expect(other.getByRole('alert').filter({hasText:'已被其他窗口修改'})).toBeVisible()
  const current=await snapshot(request),book=new ExcelJS.Workbook()
  let pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出会场 Excel'}).click()
  await book.xlsx.readFile((await (await pending).path())!)
  expect(book.getWorksheet('会场分组')!.rowCount-3).toBe(Object.keys(current.state.assignments).length)
  pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出应急台账'}).click()
  await book.xlsx.readFile((await (await pending).path())!)
  expect(book.getWorksheet('全部人员')!.rowCount).toBe(153)
  expect(book.getWorksheet('已发号码')!.rowCount-1).toBe(current.state.issuedNumbers.length)
  expect(book.getWorksheet('台账说明')!.getCell('B3').value).toBe(String(current.state.nextNumber-1).padStart(3,'0'))
  await context.close()
})
