import { mkdir, writeFile } from 'node:fs/promises'
// 仅生成明确标记的虚构数据；不读取、覆盖或衍生任何真实人员名单。
const people = Array.from({ length: 152 }, (_, index) => {
  const volunteer = index >= 139
  const number = volunteer ? index - 138 : index + 1
  const serial = String(number).padStart(3, '0')
  return {
    id: `demo-${volunteer ? 'volunteer' : 'student'}-${serial}`,
    name: `示例${volunteer ? '志工' : '学员'}${serial}`,
    company: volunteer ? '志工' : `虚构企业${String(index % 7 + 1).padStart(2, '0')}`,
    source: { sheet: volunteer ? '模拟志工名单' : '模拟学员名单', row: number, cell: `A${number}`, group: '', learningGroup: index < 60 ? `示例学习组${index % 6 + 1}` : '' },
  }
})
await mkdir('src/data', { recursive: true })
await writeFile('src/data/demo-roster.json', JSON.stringify(people, null, 2) + '\n')
await writeFile('src/data/demo-import-report.json', JSON.stringify({ sourceName: '虚构示例名单', sheets: [{ name: '模拟学员名单', count: 139 }, { name: '模拟志工名单', count: 13 }], total: 152 }, null, 2) + '\n')
console.log('已生成152条虚构示例；本地真实名单未修改。')
