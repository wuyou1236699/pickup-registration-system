export interface Person { id: string; name: string; company: string; source: { sheet: string; row: number; cell: string; group: string; learningGroup?: string } }
export interface PickupState {
  nextNumber: number
  issuedNumbers: number[]
  assignments: Record<string, number>
  batches: { ids: string[]; number: number | null }[]
  versions?: Record<string, number>
  revision?: number
}
export interface RegistrationResult { number: number | null; newlyAssigned: string[]; existing: { id: string; number: number }[] }
export interface RosterInfo { version: string; hash: string; count: number; demo: boolean }
export interface ServiceSnapshot { people: Person[]; state: PickupState; roster: RosterInfo; generatedAt: string }
export type MutationRequest =
  | { operation: 'register'; requestId: string; rosterHash: string; ids: string[] }
  | { operation: 'correct'; requestId: string; rosterHash: string; id: string; target: number | null; expectedVersion: number }
export interface MutationResponse { result: RegistrationResult | null; snapshot: ServiceSnapshot; replayed: boolean }
export interface RevisionInfo { revision: number; rosterHash: string; generatedAt: string }
export type ApiResponse = { ok: true; data: ServiceSnapshot | MutationResponse | RevisionInfo } | { ok: false; code: string; message: string; uncertain?: boolean }
