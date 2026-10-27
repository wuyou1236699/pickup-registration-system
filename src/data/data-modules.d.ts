declare const __PICKUP_DEMO__: boolean
declare const __PICKUP_SERVER__: boolean
declare const __PICKUP_API__: string
declare const __PICKUP_REVISION_SYNC__: boolean
declare const __PICKUP_DOCDB_SIMULATION__: boolean
declare const __PICKUP_CLOUDBASE__: boolean
declare const __PICKUP_FORMAL__: boolean
declare module '@pickup-roster' {
  const people: import('../domain/pickup').Person[]
  export default people
}
