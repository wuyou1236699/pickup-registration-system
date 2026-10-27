import { correctAssignment, emptyState, register, type Person, type PickupState, type RegistrationResult } from '../domain/pickup'
import type { MutationRequest, MutationResponse, ServiceSnapshot } from '../../shared/contracts'
// Async service contract alongside the preserved first-stage local adapter.
export interface SharedPickupRepository {
  getSnapshot(): Promise<ServiceSnapshot>
  mutate(input: MutationRequest): Promise<MutationResponse>
}
export interface PickupRepository {
  getSnapshot(): PickupState
  register(ids: string[]): Promise<RegistrationResult>
  correct(id: string, target: number | null): Promise<void>
}
export class LocalPickupRepository implements PickupRepository {
  private state = emptyState()
  constructor(private readonly people: Person[]) {}
  getSnapshot() { return this.state }
  async register(ids: string[]) {
    const outcome = register(this.state, ids, this.people)
    this.state = outcome.state
    return outcome.result
  }
  async correct(id: string, target: number | null) { this.state = correctAssignment(this.state, id, target, this.people) }
}
