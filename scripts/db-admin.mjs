import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createDatabase } = require('../dist/backend/cloudfunctions/pickup-api/database.js')
const { PickupService, rosterHash, validateRoster } = require('../dist/backend/cloudfunctions/pickup-api/service.js')
const args = process.argv.slice(2)
const option = key => args.find(v => v.startsWith(`--${key}=`))?.slice(key.length+3)
const action = args[0]
const target = process.env.PICKUP_TARGET_ENV
if (!target || option('confirm-target') !== target) throw new Error('必须配置 PICKUP_TARGET_ENV，并传入相同的 --confirm-target，防止操作错误环境')
const pool = createDatabase()
try {
  if (action === 'migrate') {
    const sql = await readFile(new URL('../cloudbase/migrations/001_pickup.sql',import.meta.url),'utf8')
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await pool.query(statement)
    console.log(JSON.stringify({ action, target, schemaVersion:1 }))
  } else if (action === 'init') {
    const demo = !args.includes('--real')
    const path = demo ? new URL('../src/data/demo-roster.json',import.meta.url) : option('file')
    const version = option('version') || (demo ? 'demo-v1' : undefined)
    const count = Number(option('count') || (demo ? 152 : 0))
    if (!path || !version) throw new Error('正式导入须提供 file、version、count 和 expected-hash')
    const people = validateRoster(JSON.parse(await readFile(path,'utf8')),version,count)
    const hash = rosterHash(people,version)
    if (!demo && (!args.includes('--confirm-real-import') || option('expected-hash') !== hash)) throw new Error('正式名单须明确确认上传，并核对完整 SHA-256 内容指纹；未执行上传')
    const result = await new PickupService(pool).initialize(people,version,count,demo)
    console.log(JSON.stringify({ action,target,demo,count,...result }))
  } else throw new Error('仅支持 migrate 或 init；不提供清空及覆盖操作')
} catch (error) {
  console.error(error.code || 'ADMIN_OPERATION_FAILED',error instanceof Error && !('sql' in error) ? error.message : '数据库操作失败，检查环境配置；未输出敏感信息')
  process.exitCode = 1
} finally { await pool.end() }
