import { test,expect,chromium,type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import { resetTestDatabase,testPool } from '../database/fixture'
import { PickupService,rosterHash } from '../../cloudfunctions/pickup-api/service'
import roster from '../../src/data/demo-roster.json' with { type:'json' }
const pool=testPool('pickup_browser_test'), service=new PickupService(pool),hash=rosterHash(roster,'demo-v1')
const [a,b,c]=roster
test.beforeEach(()=>resetTestDatabase(pool))
test.afterAll(()=>pool.end())
async function add(page:Page,p:typeof a) {
  const input=page.getByRole('combobox');await expect(input).toBeEnabled();await input.fill(p.name);await input.press('Enter')
  await expect(page.locator('.selected-person')).toContainText(p.name)
}
async function register(page:Page,p:typeof a) {await add(page,p);await page.getByRole('button',{name:'确认登记'}).click()}
test('独立窗口竞争同一人，以服务端实际归属为准；刷新与新上下文仍存在',async({page,browser})=>{
  const second=await browser.newContext(), other=await second.newPage()
  await Promise.all([page.goto('/'),other.goto('/')]);await Promise.all([add(page,a),add(other,a)])
  await Promise.all([page.getByRole('button',{name:'确认登记'}).click(),other.getByRole('button',{name:'确认登记'}).click()])
  await expect(page.locator('.result-panel')).toBeVisible();await expect(other.locator('.result-panel')).toBeVisible()
  const numbers=[await page.locator('.big-ticket strong').allTextContents(),await other.locator('.big-ticket strong').allTextContents()].flat()
  expect(numbers).toEqual(['001'])
  const db=await service.snapshot();expect(db.state.issuedNumbers).toEqual([1]);expect(db.state.assignments[a.id]).toBe(1)
  await page.reload();await add(page,a);await expect(page.locator('.selection-panel')).toContainText('已有 001 号')
  await other.goto('/manage');await expect(other.getByRole('row').filter({hasText:a.name})).toContainText('001 号')
  await second.close()
})
test('其他窗口轮询看到新归属；纠正版本冲突明确提示，导出读取数据库最新快照',async({page,browser})=>{
  await page.goto('/');await register(page,a);await expect(page.getByRole('heading',{name:'登记成功：001 号'})).toBeVisible()
  await page.getByRole('button',{name:'下一位接人者'}).click();await register(page,b);await expect(page.getByRole('heading',{name:'登记成功：002 号'})).toBeVisible()
  await page.goto('/manage')
  const second=await browser.newContext(), other=await second.newPage();await other.goto('/manage')
  const row=page.getByRole('row').filter({hasText:a.name}), otherRow=other.getByRole('row').filter({hasText:a.name})
  await expect(row).toContainText('001 号');await expect(otherRow).toContainText('001 号')
  await row.getByRole('button').click();await otherRow.getByRole('button').click()
  await page.getByLabel('纠正后的号码').selectOption('2');await page.getByRole('button',{name:'保存纠正'}).click()
  await expect(otherRow).toContainText('002 号',{timeout:7000})
  await other.getByLabel('纠正后的号码').selectOption('unassigned');await other.getByRole('button',{name:'保存纠正'}).click()
  await expect(other.getByRole('alert').filter({hasText:'已被其他窗口修改'})).toBeVisible()
  expect((await service.snapshot()).state.assignments[a.id]).toBe(2)
  // Mutate the DB without waiting for this browser's poll: export MUST read fresh.
  await service.mutate({operation:'register',requestId:randomUUID(),rosterHash:hash,ids:[c.id]})
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出会场 Excel'}).click()
  const file=await downloaded;expect(file.suggestedFilename()).toContain('服务端快照')
  const book=new ExcelJS.Workbook();await book.xlsx.readFile((await file.path())!)
  expect(book.getWorksheet('会场分组')!.getCell('B6').value).toBe(c.name)
  const ledgerDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出应急台账'}).click()
  const ledger=await ledgerDownload;await book.xlsx.readFile((await ledger.path())!)
  expect(book.getWorksheet('全部人员')!.rowCount).toBe(153)
  expect(book.getWorksheet('已发号码')!.getCell('B2').value).toBe(0)
  expect(book.getWorksheet('台账说明')!.getCell('B4').value).toBe('004')
  await second.close()
})
test('提交成功但响应丢失：刷新后用相同请求恢复001，不重复发牌',async({page})=>{
  const sent: string[]=[];let dropped=false
  await page.route('**/api/pickup',async route=>{
    const body=route.request().postDataJSON()
    if(body.operation==='register') {
      sent.push(body.requestId)
      if(!dropped) {dropped=true;await route.fetch();await route.abort('failed');return}
    }
    await route.continue()
  })
  await page.goto('/');await register(page,a)
  await expect(page.getByRole('button',{name:'恢复原请求结果'})).toBeVisible()
  await expect(page.getByRole('button',{name:'确认登记'})).toBeDisabled()
  expect((await service.snapshot()).state.assignments[a.id]).toBe(1)
  await page.reload();await expect(page.getByRole('button',{name:'恢复原请求结果'})).toBeVisible()
  await page.getByRole('button',{name:'恢复原请求结果'}).click()
  await expect(page.getByRole('heading',{name:'登记成功：001 号'})).toBeVisible()
  expect(sent).toHaveLength(2);expect(sent[0]).toBe(sent[1])
  expect((await service.snapshot()).state.nextNumber).toBe(2)
  await page.getByRole('button',{name:'下一位接人者'}).click();await register(page,b)
  await expect(page.getByRole('heading',{name:'登记成功：002 号'})).toBeVisible()
})
test('初始连接失败和云函数异常有明确提示，无静默切换本地模拟',async({page})=>{
  await page.route('**/api/pickup',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,code:'DATABASE_UNAVAILABLE',message:'服务暂时不可用',uncertain:true})}))
  await page.goto('/');await expect(page.getByRole('alert')).toContainText('服务暂时不可用')
  await expect(page.getByRole('button',{name:'确认登记'})).toBeDisabled()
  await expect(page.locator('.local-badge')).toContainText('共享数据库')
  await page.unroute('**/api/pickup');await page.getByRole('button',{name:'刷新名单'}).click();await add(page,a)
  await page.route('**/api/pickup',async route=>{
    if(route.request().postDataJSON().operation==='register') await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,code:'DATABASE_UNAVAILABLE',message:'服务暂时不可用；提交结果尚未确定',uncertain:true})})
    else await route.continue()
  })
  await page.getByRole('button',{name:'确认登记'}).click();await expect(page.getByRole('button',{name:'恢复原请求结果'})).toBeVisible()
  await expect(page.locator('.big-ticket')).toHaveCount(0)
})

test('同一浏览器的两个标签页：未确定请求独立保存，一页成功不会清掉另一页',async({page,context})=>{
  await page.route('**/api/pickup',async route=>{
    if(route.request().postDataJSON().operation==='register') {await route.fetch();await route.abort('failed')}
    else await route.continue()
  })
  await page.goto('/');await register(page,a);await expect(page.getByRole('button',{name:'恢复原请求结果'})).toBeVisible()
  const other=await context.newPage();await other.goto('/');await register(other,b);await expect(other.getByRole('heading',{name:'登记成功：002 号'})).toBeVisible()
  await page.reload();await expect(page.getByRole('button',{name:'恢复原请求结果'})).toBeVisible()
  await page.unroute('**/api/pickup');await page.getByRole('button',{name:'恢复原请求结果'}).click()
  await expect(page.getByRole('heading',{name:'登记成功：001 号'})).toBeVisible()
  expect((await service.snapshot()).state.issuedNumbers).toEqual([1,2])
})

test('Chromium与Microsoft Edge同时连接同一数据库并看到相同归属',async({page},info)=>{
  const otherBrowser=await chromium.launch(info.project.name==='edge' ? {} : {channel:'msedge'})
  try {
    const other=await otherBrowser.newPage()
    await Promise.all([page.goto('/'),other.goto('http://127.0.0.1:5175/')])
    await Promise.all([add(page,a),add(other,a)])
    await Promise.all([page.getByRole('button',{name:'确认登记'}).click(),other.getByRole('button',{name:'确认登记'}).click()])
    await expect(page.locator('.result-panel')).toBeVisible();await expect(other.locator('.result-panel')).toBeVisible()
    expect([await page.locator('.big-ticket strong').allTextContents(),await other.locator('.big-ticket strong').allTextContents()].flat()).toEqual(['001'])
    await Promise.all([page.goto('/manage'),other.goto('http://127.0.0.1:5175/manage')])
    await expect(page.getByRole('row').filter({hasText:a.name})).toContainText('001 号')
    await expect(other.getByRole('row').filter({hasText:a.name})).toContainText('001 号')
  } finally {await otherBrowser.close()}
})
