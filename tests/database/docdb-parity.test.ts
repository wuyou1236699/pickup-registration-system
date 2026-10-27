import { afterAll, beforeEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import roster from '../../src/data/demo-roster.json'
import { PickupService } from '../../cloudfunctions/pickup-api/service'
import { DocumentPickupService } from '../../cloudfunctions/pickup-docdb/service'
import { DocumentSimulator } from '../../local-tools/docdb-simulator'
import { rosterHash } from '../../shared/server-validation'
import type { MutationRequest, ServiceSnapshot } from '../../shared/contracts'
import { resetTestDatabase, testPool } from './fixture'
const pool=testPool('pickup_phase2_test'), sql=new PickupService(pool)
let docs: DocumentPickupService
const hash=rosterHash(roster,'demo-v1'),[a,b,c]=roster
beforeEach(async()=>{await resetTestDatabase(pool);docs=new DocumentPickupService(new DocumentSimulator(),'pickup_docdb_parity');await docs.initialize(roster,'demo-v1',152,true)})
afterAll(()=>pool.end())
const state=(s:ServiceSnapshot)=>({people:s.people,roster:s.roster,assignments:s.state.assignments,versions:s.state.versions,revision:s.state.revision,nextNumber:s.state.nextNumber,issuedNumbers:s.state.issuedNumbers})
it('真实本地MySQL与文档库模拟执行相同登记、混合、全已分配、纠正、空号、重放序列',async()=>{
  const first:MutationRequest={operation:'register',requestId:randomUUID(),rosterHash:hash,ids:[a.id,b.id]}
  const sequence:MutationRequest[]=[first,{...first,requestId:randomUUID(),ids:[a.id,c.id]},{...first,requestId:randomUUID(),ids:[a.id,b.id,c.id]},
    {operation:'correct',requestId:randomUUID(),rosterHash:hash,id:a.id,target:2,expectedVersion:1},
    {operation:'correct',requestId:randomUUID(),rosterHash:hash,id:b.id,target:null,expectedVersion:1},first]
  for(const req of sequence) {
    const [x,y]=await Promise.all([sql.mutate(req),docs.mutate(req)])
    expect(y.result).toEqual(x.result);expect(y.replayed).toBe(x.replayed);expect(state(y.snapshot)).toEqual(state(x.snapshot))
  }
  const stale:MutationRequest={operation:'correct',requestId:randomUUID(),rosterHash:hash,id:a.id,target:null,expectedVersion:1}
  await expect(sql.mutate(stale)).rejects.toMatchObject({code:'ASSIGNMENT_CONFLICT'})
  await expect(docs.mutate(stale)).rejects.toMatchObject({code:'ASSIGNMENT_CONFLICT'})
  expect(state(await docs.snapshot())).toEqual(state(await sql.snapshot()))
})
