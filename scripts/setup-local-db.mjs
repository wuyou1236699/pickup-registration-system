import mysql from 'mysql2/promise'
import { randomBytes } from 'node:crypto'
import { access,writeFile } from 'node:fs/promises'
try { await access('.env.local'); console.log('保留已有 .env.local；未覆盖任何连接配置。');process.exit(0) } catch(error) {if(error.code!=='ENOENT')throw error}
let conn
for(let i=0;i<15;i++) {
  try {conn=await mysql.createConnection({host:'127.0.0.1',port:33307,user:'root'});break}
  catch {if(i===14)throw new Error('隔离的本地数据库尚未启动或已设有密码；未覆盖配置');await new Promise(r=>setTimeout(r,500))}
}
try {
  const pass=randomBytes(32).toString('hex'), rootPass=randomBytes(32).toString('hex')
  for(const database of ['pickup_local_demo','pickup_phase2_test','pickup_browser_test']) await conn.query(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4`)
  await conn.query("CREATE USER 'pickup_local'@'localhost' IDENTIFIED BY ?",[pass])
  for(const database of ['pickup_local_demo','pickup_phase2_test','pickup_browser_test']) await conn.query(`GRANT ALL ON ${database}.* TO 'pickup_local'@'localhost'`)
  await conn.query("GRANT SHUTDOWN ON *.* TO 'pickup_local'@'localhost'")
  await writeFile('.local-runtime/root-credentials.local',rootPass,{flag:'wx'})
  await writeFile('.env.local',`MYSQL_HOST=127.0.0.1\nMYSQL_PORT=33307\nMYSQL_USER=pickup_local\nMYSQL_PASSWORD=${pass}\nMYSQL_DATABASE=pickup_local_demo\nMYSQL_TLS=false\nPICKUP_TARGET_ENV=local-demo\nPICKUP_DEV_PROXY=http://127.0.0.1:3001\n`,{flag:'wx'})
  await conn.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?",[rootPass])
  console.log('随机密码与本地连接已保存到Git忽略文件。仅创建项目的三个隔离数据库。')
} catch {
  console.error('本地数据库设置失败；保留已有文件，未输出SQL或密钥。请检查隔离实例与本地配置。')
  process.exitCode=1
} finally {await conn.end()}
