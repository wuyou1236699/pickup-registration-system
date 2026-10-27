import { readFileSync } from 'node:fs'
import { createPool, type Pool } from 'mysql2/promise'
export function createDatabase(): Pool {
  const { MYSQL_HOST: host, MYSQL_USER: user, MYSQL_DATABASE: database } = process.env
  if (!host || !user || !database) throw new Error('数据库连接未配置')
  const local = host === '127.0.0.1' || host === 'localhost'
  if (!local && process.env.MYSQL_TLS !== 'true') throw new Error('远程数据库必须启用 TLS')
  return createPool({ host, user, database, port: Number(process.env.MYSQL_PORT || 3306), password: process.env.MYSQL_PASSWORD,
    connectionLimit: 4, waitForConnections: true, queueLimit: 16, connectTimeout: 5000, charset: 'utf8mb4',
    multipleStatements: false, timezone: 'Z',
    ssl: local && process.env.MYSQL_TLS !== 'true' ? undefined : { rejectUnauthorized: true, ca: process.env.MYSQL_CA_FILE ? readFileSync(process.env.MYSQL_CA_FILE, 'utf8') : undefined } })
}
