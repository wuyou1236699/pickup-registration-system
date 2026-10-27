import type { Person, PickupState, RegistrationResult } from '../../shared/contracts'
export type { Person, PickupState, RegistrationResult } from '../../shared/contracts'
export const emptyState = (): PickupState => ({ nextNumber: 1, issuedNumbers: [], assignments: {}, batches: [] })
export const formatNumber = (n: number) => String(n).padStart(3, '0')
export function register(state: PickupState, ids: string[], people: Person[]): { state: PickupState; result: RegistrationResult } {
  const unique = [...new Set(ids)]
  if (!unique.length) throw new Error('请先选择人员')
  const known = new Set(people.map(p => p.id))
  if (unique.some(id => !known.has(id))) throw new Error('名单中不存在该人员')
  const newlyAssigned = unique.filter(id => state.assignments[id] === undefined)
  const existing = unique.filter(id => state.assignments[id] !== undefined).map(id => ({ id, number: state.assignments[id] }))
  const number = newlyAssigned.length ? state.nextNumber : null
  const assignments = { ...state.assignments }
  if (number !== null) newlyAssigned.forEach(id => { assignments[id] = number })
  return { state: { nextNumber: number !== null ? state.nextNumber + 1 : state.nextNumber, issuedNumbers: number !== null ? [...state.issuedNumbers, number] : state.issuedNumbers, assignments, batches: [...state.batches, { ids: unique, number }] }, result: { number, newlyAssigned, existing } }
}
export function correctAssignment(state: PickupState, id: string, target: number | null, people: Person[]): PickupState {
  if (!people.some(p => p.id === id)) throw new Error('名单中不存在该人员')
  if (target !== null && !state.issuedNumbers.includes(target)) throw new Error('只能移入已发放的号码牌')
  const assignments = { ...state.assignments }
  if (target === null) delete assignments[id]
  else assignments[id] = target
  // 已发放号码永久保留；撤销或移组不回收编号。
  return { ...state, assignments }
}
export function searchPeople(people: Person[], query: string): Person[] {
  const q = query.trim().toLocaleLowerCase()
  return people.filter(p => `${p.name} ${p.company} ${p.source.learningGroup ?? ''}`.toLocaleLowerCase().includes(q))
}
