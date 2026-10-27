import { createDocumentDatabase } from './database'
import { DocumentPickupService } from './service'
import { handleRequest } from '../../shared/server-handler'
let service: DocumentPickupService|undefined
export async function main(event: unknown) {
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
  const reply=(statusCode:number,data:unknown)=>({statusCode,headers,body:JSON.stringify(data)})
  if(process.env.PICKUP_DOCDB_HTTP_ENABLED!=='true') return reply(503,{ok:false,code:'ACCESS_NOT_CONFIGURED',message:'访问保护尚未配置'})
  if(!event || typeof event!=='object' || !('httpMethod' in event) || event.httpMethod!=='POST' || !('body' in event) || typeof event.body!=='string' || Buffer.byteLength(event.body)>65536) return reply(400,{ok:false,code:'INVALID_REQUEST',message:'请求不正确'})
  let value: unknown
  try {value=JSON.parse(event.body)} catch {return reply(400,{ok:false,code:'INVALID_JSON',message:'请求格式不正确'})}
  try {service??=new DocumentPickupService(createDocumentDatabase(),process.env.PICKUP_DOCDB_PREFIX || '')}
  catch {return reply(503,{ok:false,code:'DATABASE_NOT_CONFIGURED',message:'文档数据库尚未配置',uncertain:true})}
  const result=await handleRequest(value,service)
  return reply(result.ok ? 200 : result.uncertain ? 503 : 400,result)
}
