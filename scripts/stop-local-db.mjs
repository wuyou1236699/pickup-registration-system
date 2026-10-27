import mysql from 'mysql2/promise'
if(process.env.MYSQL_HOST!=='127.0.0.1' || process.env.MYSQL_PORT!=='33307')throw new Error('只允许停止项目本地33307数据库，拒绝云端配置')
const conn=await mysql.createConnection({host:'127.0.0.1',port:33307,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD})
try {await conn.query('SHUTDOWN');console.log('本地 MySQL 已正常停止，数据文件保留。')}
finally {await conn.end()}
