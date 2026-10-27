import http from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createDatabase } = require('../dist/backend/cloudfunctions/pickup-api/database.js')
const { PickupService } = require('../dist/backend/cloudfunctions/pickup-api/service.js')
const { handleRequest } = require('../dist/backend/cloudfunctions/pickup-api/index.js')
const pool = createDatabase(), service = new PickupService(pool)
const port = Number(process.env.PICKUP_LOCAL_API_PORT || 3001)
const server = http.createServer(async(req,res) => {
  const headers = { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store' }
  const send = (status,data) => { res.writeHead(status,headers);res.end(JSON.stringify(data)) }
  if(req.url === '/health' && req.method === 'GET') {send(200,{ok:true});return}
  if(req.url !== '/api/pickup' || req.method !== 'POST') { send(404,{ok:false,code:'NOT_FOUND',message:'接口不存在'});return }
  let raw = ''
  try {
    for await (const part of req) { raw += part.toString(); if(Buffer.byteLength(raw)>65536) {send(413,{ok:false,code:'TOO_LARGE',message:'请求过大'});return} }
    const value = JSON.parse(raw)
    const response = await handleRequest(value,service)
    send(response.ok ? 200 : response.uncertain ? 503 : 400,response)
  } catch { send(400,{ok:false,code:'INVALID_JSON',message:'请求格式不正确'}) }
})
server.listen(port,'127.0.0.1',()=>console.log(`本地数据库验证接口：http://127.0.0.1:${port}/api/pickup`))
const close = () => server.close(()=>{pool.end().then(()=>process.exit(0))})
process.on('SIGINT',close);process.on('SIGTERM',close)
