import { readFile } from 'node:fs/promises'
import { createPool, type Pool } from 'mysql2/promise'
import { PickupService } from '../../cloudfunctions/pickup-api/service'
import roster from '../../src/data/demo-roster.json' with { type:'json' }
// This harness ONLY touches its two isolated loopback test schemas, never the
// configured runtime schema and never a CloudBase database or a real roster.
export function testPool(database: 'pickup_phase2_test' | 'pickup_browser_test'): Pool {
  if (process.env.MYSQL_HOST !== '127.0.0.1' || process.env.MYSQL_DATABASE === database) throw new Error('测试必须使用隔离的本地数据库配置，不能指向运行库')
  return createPool({host:'127.0.0.1',port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database,connectionLimit:10,charset:'utf8mb4'})
}
export async function resetTestDatabase(pool: Pool) {
  const sql = await readFile(new URL('../../cloudbase/migrations/001_pickup.sql',import.meta.url),'utf8')
  for (const s of sql.split(';').map(s=>s.trim()).filter(Boolean)) await pool.query(s)
  for (const table of ['pickup_audit','pickup_requests','pickup_assignments','pickup_tickets','pickup_people','pickup_roster']) await pool.query(`DELETE FROM ${table}`)
  await pool.query('UPDATE pickup_control SET next_number=1,revision=0 WHERE id=1')
  await new PickupService(pool).initialize(roster,'demo-v1',152,true)
}
