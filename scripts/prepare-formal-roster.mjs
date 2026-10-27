import ExcelJS from 'exceljs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { parseFormalRoster } from './parse-formal-roster.mjs'
const [source, volunteerFile] = process.argv.slice(2)
if (!source) throw new Error('请提供原 Excel 路径；可另传本地志工姓名 JSON 数组路径')
const bytes = await readFile(source)
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.load(bytes)
const volunteers = volunteerFile ? JSON.parse(await readFile(volunteerFile,'utf8')) : []
if (!Array.isArray(volunteers) || !volunteers.every(v => typeof v === 'string' && v.trim())) throw new Error('志工配置须为姓名数组')
const {people, sheets} = parseFormalRoster(workbook, volunteers)
const folder = resolve('.git-preparation/formal-roster')
await mkdir(folder,{recursive:true})
const withGroup = people.filter(p => p.source.learningGroup.trim()).length
await writeFile(join(folder,'prepared.local.json'), JSON.stringify(people,null,2)+'\n')
const report = {sourceSha256:createHash('sha256').update(bytes).digest('hex'), sheets, total:people.length, withGroup, withoutGroup:people.length-withGroup, volunteerCount:volunteers.length, cloudImport:false}
await writeFile(join(folder,'report.local.json'), JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({total:report.total, withGroup, withoutGroup:report.withoutGroup, volunteerCount:report.volunteerCount, cloudImport:false}))
