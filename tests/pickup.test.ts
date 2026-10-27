import { describe, expect, it } from 'vitest'
import { emptyState, register, correctAssignment, searchPeople, type Person } from '../src/domain/pickup'
import { LocalPickupRepository } from '../src/services/pickup-repository'
import roster from '../src/data/demo-roster.json'
import report from '../src/data/demo-import-report.json'
const people: Person[] = roster
const ids = people.slice(0, 7).map(p => p.id)
describe('模拟名单', () => {
  it('共享示例仅含明确虚构姓名、公司和独立示例ID', () => {
    expect(people).toHaveLength(152)
    expect(people.every(p => /^示例(学员|志工)\d{3}$/.test(p.name))).toBe(true)
    expect(people.every(p => p.company === '志工' || /^虚构企业\d{2}$/.test(p.company))).toBe(true)
    expect(people.every(p => p.id.startsWith('demo-'))).toBe(true)
  })
  it('按真实非空姓名导入，志工公司统一且没有姓名合并', () => {
    expect(people).toHaveLength(report.total)
    expect(people.filter(p => p.source.sheet === report.sheets[0].name)).toHaveLength(139)
    expect(new Set(people.map(p => p.id)).size).toBe(people.length)
    expect(people.every(p => p.name.trim() && p.name !== '姓名')).toBe(true)
    expect(people.filter(p => p.source.sheet === report.sheets[1].name)).toHaveLength(13)
    expect(people.filter(p => p.source.sheet === report.sheets[1].name).every(p => p.company === '志工')).toBe(true)
    for (const p of people) expect(searchPeople(people, p.name)).toContain(p)
  })
})
describe('登记和分组', () => {
  it('一人、多人与混合登记按成功顺序分配；已有归属保留', () => {
    let first = register(emptyState(), [ids[0]], people)
    expect(first.result.number).toBe(1)
    const second = register(first.state, [ids[1], ids[2]], people)
    expect(second.result.newlyAssigned).toEqual([ids[1], ids[2]])
    const mixed = register(second.state, [ids[0], ids[1], ids[3]], people)
    expect(mixed.result).toEqual({ number: 3, newlyAssigned: [ids[3]], existing: [{id:ids[0],number:1},{id:ids[1],number:2}] })
    expect(mixed.state.assignments[ids[0]]).toBe(1)
    const allExisting = register(mixed.state, [ids[0],ids[3]], people)
    expect(allExisting.result.number).toBeNull()
    expect(allExisting.state.nextNumber).toBe(4)
    expect(register(allExisting.state, [ids[4]], people).result.number).toBe(4)
  })
  it('空提交与不存在的人员被拒绝，重复 ID 只分配一次', () => {
    expect(() => register(emptyState(), [], people)).toThrow()
    expect(() => register(emptyState(), ['missing'], people)).toThrow()
    expect(register(emptyState(), [ids[0],ids[0]], people).result.newlyAssigned).toEqual([ids[0]])
  })
  it('撤销与移组保留已发号码，撤销后再次登记使用下一个号', () => {
    const a = register(emptyState(), [ids[0],ids[1]], people)
    const b = register(a.state, [ids[2]], people)
    const c = correctAssignment(b.state, ids[0], 2, people)
    expect(c.assignments[ids[0]]).toBe(2)
    const d = correctAssignment(c, ids[1], null, people)
    expect(d.assignments[ids[1]]).toBeUndefined()
    expect(d.issuedNumbers).toEqual([1,2])
    expect(register(d, [ids[1]], people).result.number).toBe(3)
    expect(() => correctAssignment(d, ids[0], 99, people)).toThrow()
  })
  it('同名记录按内部 ID 独立分配', () => {
    const duplicates = [{...people[0],id:'same-a',name:'同名'}, {...people[0],id:'same-b',name:'同名'}]
    const a = register(emptyState(), ['same-a'], duplicates)
    expect(a.state.assignments['same-b']).toBeUndefined()
    expect(register(a.state, ['same-b'], duplicates).result.number).toBe(2)
  })
  it('页面共用仓库状态，后续读取与纠正保持一致', async () => {
    const repository = new LocalPickupRepository(people)
    await repository.register([ids[0],ids[1]])
    expect(repository.getSnapshot().assignments[ids[1]]).toBe(1)
    await repository.correct(ids[1], null)
    expect(repository.getSnapshot().assignments[ids[1]]).toBeUndefined()
  })
})
