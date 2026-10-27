import { createHash } from 'node:crypto'

// Only cached formula results are read. Never recalculate external lookups.
function text(cell, optional = false) {
  const raw = cell.value
  const formula = raw && typeof raw === 'object' && ('formula' in raw || 'sharedFormula' in raw)
  // ExcelJS cell.value omits a cached numeric zero; cell.result preserves it.
  if (formula && cell.result === undefined) throw new Error(`公式缺少缓存结果：${cell.address}`)
  const value = formula ? cell.result : raw
  if (value == null || value === '' || (optional && formula && value === 0)) return ''
  if (typeof value !== 'string') throw new Error(`字段不是文本或存在公式错误：${cell.address}`)
  return value
}

export function parseFormalRoster(workbook, volunteerNames = []) {
  const people = []
  const sheets = []
  for (const sheet of workbook.worksheets) {
    const header = sheet.getRow(1)
    if (header.getCell(2).text !== '姓名' || header.getCell(3).text !== '学习小组' || header.getCell(4).text !== '企业名称（发票抬头）') {
      throw new Error(`工作表结构不匹配，停止准备：${sheet.name}`)
    }
    let count = 0
    sheet.eachRow((row, number) => {
      if (number === 1) return
      const name = text(row.getCell(2))
      if (!name.trim()) {
        if (row.getCell(3).text || row.getCell(4).text) throw new Error(`存在缺少姓名的数据行：${number}`)
        return
      }
      const learningGroup = text(row.getCell(3), true)
      const company = text(row.getCell(4))
      if (row.getCell(2).isMerged || row.getCell(3).isMerged) throw new Error(`姓名或学习小组合并，须人工确认：${number}`)
      const cell = row.getCell(2).address
      const id = createHash('sha256').update(`formal-roster-v1\0${sheet.name}\0${cell}`).digest('hex').slice(0, 24)
      people.push({id, name, company, source:{sheet:sheet.name, row:number, cell, group:'', learningGroup}})
      count++
    })
    sheets.push({name:sheet.name, count})
  }
  if (!people.length || new Set(people.map(p => p.id)).size !== people.length) throw new Error('名单为空或 ID 冲突')
  // The user-supplied volunteer list labels records; it never merges identity.
  for (const name of new Set(volunteerNames)) {
    const matches = people.filter(p => p.name.trim() === name.trim())
    if (matches.length !== 1) throw new Error('志工姓名不能唯一对应，须按人员记录确认')
    matches[0].company += '（志工）'
  }
  return {people, sheets}
}
