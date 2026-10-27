import http from 'node:http'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
const require = createRequire(import.meta.url)
const { DocumentSimulator } = require('../.local-runtime/docdb-tools/local-tools/docdb-simulator.js')
const { DocumentPickupService } = require('../.local-runtime/docdb-tools/cloudfunctions/pickup-docdb/service.js')
const { handleRequest } = require('../.local-runtime/docdb-tools/shared/server-handler.js')
const runtime = resolve('.local-runtime')
const file = resolve(runtime, process.env.PICKUP_DOCDB_SIM_FILE || 'docdb-simulator.json')
const part = relative(runtime, file)
if (part.startsWith('..') || isAbsolute(part)) throw new Error('模拟文件必须位于 .local-runtime 内')
const db = new DocumentSimulator(file), service = new DocumentPickupService(db, 'pickup_docdb_local')
// This local server accepts ONLY the committed fictional roster. No cloud SDK/credentials.
const people = JSON.parse(await readFile('src/data/demo-roster.json', 'utf8'))
await service.initialize(people, 'docdb-demo-v1', 152, true)
const port = Number(process.env.PICKUP_DOCDB_SIM_PORT || 3003)
const server = http.createServer(async (req,res) => {
  const send = (status, data) => {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'})
    res.end(JSON.stringify(data))
  }
  if (req.url === '/health' && req.method === 'GET') {send(200,{ok:true,simulation:true});return}
  if (req.url !== '/api/pickup' || req.method !== 'POST') {send(404,{ok:false,code:'NOT_FOUND',message:'接口不存在'});return}
  let raw = ''
  try {
    for await (const part of req) {raw += part.toString(); if(Buffer.byteLength(raw)>65536) {send(413,{ok:false,code:'TOO_LARGE',message:'请求过大'});return}}
    const response = await handleRequest(JSON.parse(raw),service)
    send(response.ok ? 200 : response.uncertain ? 503 : 400,response)
  } catch {send(400,{ok:false,code:'INVALID_JSON',message:'请求格式不正确'})}
})
server.listen(port,'127.0.0.1',()=>console.log(`文档库本地事务模拟（非 CloudBase）：http://127.0.0.1:${port}/api/pickup`))
const close = () => server.close(()=>process.exit(0))
process.on('SIGINT',close);process.on('SIGTERM',close)
