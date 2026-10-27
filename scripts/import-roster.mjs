import ExcelJS from 'exceljs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const source = process.argv[2]
if (!source) throw new Error('请提供原始 Excel 路径：npm run import:roster -- "路径"')
const bytes = await readFile(source)
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.load(bytes)
if (workbook.worksheets.length !== 2) throw new Error('预期两个工作表，请检查文件结构')
const people = []
const sheets = []
for (const [index, sheet] of workbook.worksheets.entries()) {
  let count = 0
  let group = ''
  sheet.eachRow((row, rowNumber) => {
    const volunteer = index === 1
    const nameCell = row.getCell(volunteer ? 1 : 3)
    // 标题横向合并时 ExcelJS 会把标题值映射到 C 列；它不是姓名记录。
    if (nameCell.isMerged && nameCell.master.address !== nameCell.address) return
    const name = nameCell.text
    if (!name.trim() || (!volunteer && name === '姓名')) return
    if (!volunteer && !Number.isFinite(Number(row.getCell(2).value))) throw new Error(`未识别的数据行 ${sheet.name}:${rowNumber}`)
    if (!volunteer && row.getCell(1).text) group = row.getCell(1).text
    const id = createHash('sha256').update(`final-signin-v1\u0000${sheet.name}\u0000${nameCell.address}`).digest('hex').slice(0, 24)
    people.push({ id, name, company: volunteer ? '志工' : row.getCell(4).text, source: { sheet: sheet.name, row: rowNumber, cell: nameCell.address, group: volunteer ? '' : group } })
    count++
  })
  sheets.push({ name: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount, count })
}
if (new Set(people.map(p => p.id)).size !== people.length) throw new Error('ID 冲突')
const duplicates = people.filter((p, i) => people.findIndex(q => q.name === p.name) !== i).map(p => ({name:p.name, id:p.id}))
await mkdir('src/data', { recursive: true })
await writeFile('src/data/roster.json', JSON.stringify(people, null, 2) + '\n')
await writeFile('src/data/import-report.json', JSON.stringify({ sourceName: '最终签到表.xlsx', sourceSha256: createHash('sha256').update(bytes).digest('hex'), sheets, total: people.length, duplicates }, null, 2) + '\n')
console.log(JSON.stringify({sheets,total:people.length,duplicates}, null, 2))
