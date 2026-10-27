import { formatNumber, type Person, type PickupState } from '../domain/pickup'
export function exportRows(people: Person[], state: PickupState) {
  return people.filter(p => state.assignments[p.id] !== undefined).sort((a, b) => state.assignments[a.id] - state.assignments[b.id] || people.indexOf(a) - people.indexOf(b)).map(p => [formatNumber(state.assignments[p.id]), p.name, p.company])
}
export function generationTime(date: Date) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)
}
export async function createExport(people: Person[], state: PickupState, date = new Date(), label = '本地模拟') {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = `现场接人登记（${label}）`
  workbook.created = date
  const sheet = workbook.addWorksheet('会场分组', { views: [{ state: 'frozen', ySplit: 3 }] })
  sheet.columns = [{ width: 16 }, { width: 18 }, { width: 56 }]
  sheet.addRow([`会场分组名单（${label}）`])
  sheet.mergeCells('A1:C1')
  sheet.addRow([`生成时间：${generationTime(date)}（北京时间）`])
  sheet.mergeCells('A2:C2')
  sheet.addRow(['号码牌', '姓名', '公司'])
  const rows = exportRows(people, state)
  rows.forEach(values => sheet.addRow(values))
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: 'FF0D7666' } }
  sheet.getRow(2).font = { size: 10, color: { argb: 'FF64748B' } }
  sheet.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(3).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D7666' } } })
  let last = ''; let group = 0
  rows.forEach((values, index) => {
    if (last !== values[0]) { group++; last = values[0] }
    const row = sheet.getRow(index + 4)
    row.height = 30
    row.eachCell(cell => {
      cell.alignment = { vertical: 'middle', wrapText: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: group % 2 ? 'FFF0F8F5' : 'FFFFFFFF' } }
    })
    row.getCell(1).numFmt = '@'
    row.getCell(1).font = { bold: true, color: { argb: 'FF0D7666' } }
  })
  for (let start = 0; start < rows.length;) {
    let end = start + 1
    while (end < rows.length && rows[end][0] === rows[start][0]) end++
    if (end - start > 1) sheet.mergeCells(start + 4, 1, end + 3, 1)
    sheet.getCell(start + 4, 1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    start = end
  }
  for (let row = 3; row <= rows.length + 3; row++) {
    for (let col = 1; col <= 3; col++) {
      sheet.getCell(row, col).border = {
        top: { style: 'thin', color: { argb: 'FF9CB5AC' } },
        bottom: { style: 'thin', color: { argb: 'FF9CB5AC' } },
        left: { style: 'thin', color: { argb: 'FF9CB5AC' } },
        right: { style: 'thin', color: { argb: 'FF9CB5AC' } },
      }
    }
  }
  sheet.autoFilter = { from: 'A3', to: `C${Math.max(3, rows.length + 3)}` }
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:3' }
  return { buffer: await workbook.xlsx.writeBuffer(), filename: `会场分组_${label}_${generationTime(date).replace(/[-: ]/g, '')}.xlsx` }
}
export async function downloadExport(people: Person[], state: PickupState, date = new Date(), label = '本地模拟') {
  await downloadWorkbook(await createExport(people, state, date, label))
}
async function downloadWorkbook({ buffer, filename }: Awaited<ReturnType<typeof createExport>>) {
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function createEmergencyExport(people: Person[], state: PickupState, date = new Date(), label = '本地模拟') {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = `现场接人登记（${label}）`
  workbook.created = date
  const issued = [...state.issuedNumbers].sort((a,b) => a-b)
  const maximum = issued.length ? Math.max(...issued) : 0
  const time = generationTime(date)
  const notes = workbook.addWorksheet('台账说明')
  notes.columns = [{ width: 25 }, { width: 100 }]
  notes.addRows([
    [`应急登记台账（${label}）`],
    ['导出时间（北京时间）', time],
    ['当前最大已发号码', maximum ? formatNumber(maximum) : '无'],
    ['后续人工登记起始号码', formatNumber(maximum + 1)],
    ['全部人员数', people.length],
    ['使用方法', '先在「全部人员」查找姓名和公司；已有号码保持归属，未分配人员才安排新号码。同名人员按台账序号区分，不要合并。'],
    ['人工续号', `从 ${formatNumber(maximum + 1)} 号开始，每批新分配人员共用一号，按人工登记成功顺序递增。全部已有归属的批次不占新号。`],
    ['登记记录', '在「全部人员」的人工登记号码、时间、备注栏填写新分配或纠正结果，并在「已发号码」末尾追加新号。后续核对同时查看导出时归属和人工登记栏。'],
    ['空号码', '已发号码即使暂无人员也不可回收；不要填补历史空号。'],
    ['有效范围', `仅为导出时的${label}。导出后页面变更不会自动更新此文件；人工登记无自动回传或云端同步。`],
    ['切换离线前', '通知所有工作人员停止线上发号，核对未确定的提交结果后再开始人工续号。请勿线上与 Excel 同时发号。'],
    ['快照修订', state.revision ?? '本地模拟'],
  ])
  notes.getColumn(2).alignment = { vertical: 'middle', wrapText: true }
  for (let i=6; i<=10; i++) notes.getRow(i).height = 42
  const all = workbook.addWorksheet('全部人员', { views: [{ state:'frozen', ySplit:1 }] })
  all.columns = [{ width:12 },{ width:18 },{ width:56 },{ width:20 },{ width:20 },{ width:24 },{ width:35 },{ width:40 }]
  all.addRow(['台账序号','姓名','公司','导出时号码归属','人工登记号码','人工登记时间','备注','人员内部 ID'])
  people.forEach((p,index) => all.addRow([index+1,p.name,p.company,state.assignments[p.id] === undefined ? '未分配' : formatNumber(state.assignments[p.id]),'','','',p.id]))
  all.getColumn(4).numFmt = '@'
  all.getColumn(5).numFmt = '@'
  all.autoFilter = { from:'A1',to:`H${people.length+1}` }
  const numbers = workbook.addWorksheet('已发号码', { views:[{state:'frozen',ySplit:1}] })
  numbers.columns = [{width:16},{width:18},{width:28},{width:35}]
  numbers.addRow(['号码牌','导出时人数','号码情况','人工登记备注'])
  issued.forEach(n => {
    const count = people.filter(p => state.assignments[p.id] === n).length
    numbers.addRow([formatNumber(n),count,count ? '已发放' : '已发放（当前空号）',''])
  })
  numbers.getColumn(1).numFmt = '@'
  for (const sheet of [all,numbers]) {
    sheet.getRow(1).font = {bold:true,color:{argb:'FFFFFFFF'}}
    sheet.getRow(1).eachCell(cell => {cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF0D7666'}}})
    sheet.eachRow((row,index) => {
      if(index>1) {row.height=32; row.alignment={vertical:'middle',wrapText:true}}
    })
  }
  notes.getRow(1).font = {bold:true,size:16,color:{argb:'FF0D7666'}}
  return {buffer:await workbook.xlsx.writeBuffer(),filename:`应急台账_${label}_${time.replace(/[-: ]/g,'')}.xlsx`}
}
export async function downloadEmergencyExport(people: Person[], state: PickupState, date = new Date(), label = '本地模拟') {
  await downloadWorkbook(await createEmergencyExport(people,state,date,label))
}
