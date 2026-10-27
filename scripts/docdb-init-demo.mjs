import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
// Prepare-only tool: never run until the owner approves the exact new cloud resources.
// SDK uses approved temporary server credentials, never a browser secret.
const env=process.env.PICKUP_DOCDB_ENV, prefix=process.env.PICKUP_DOCDB_PREFIX
if (!env || !prefix || !/^pickup_docdb_[a-z0-9_]{1,30}$/.test(prefix) ||
    !process.argv.includes(`--confirm-cloud-test=${env}`) || !process.argv.includes(`--confirm-prefix=${prefix}`)) {
  throw new Error('必须明确确认隔离环境和集合前缀；未获所有者批准不得执行')
}
const require=createRequire(import.meta.url)
const { createDocumentDatabase }=require('../dist/docdb/cloudfunctions/pickup-docdb/database.js')
const { DocumentPickupService }=require('../dist/docdb/cloudfunctions/pickup-docdb/service.js')
const people=JSON.parse(await readFile('src/data/demo-roster.json','utf8'))
// Only the fixed committed fake roster is accepted; no --real or external filename.
const result=await new DocumentPickupService(createDocumentDatabase(),prefix).initialize(people,'docdb-demo-v1',152,true)
console.log(JSON.stringify({initialized:true,reused:result.reused,people:152}))
