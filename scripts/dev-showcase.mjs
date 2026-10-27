import { spawn } from 'node:child_process'
const children = []
const run = (args, env = {}) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  children.push(child)
  return child
}
const build = run(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.docdb-local.json'])
build.on('exit', code => {
  if (code !== 0) { process.exitCode = code || 1; return }
  const pack = run(['scripts/package-docdb-local.mjs'])
  pack.on('exit', code => {
    if (code !== 0) { process.exitCode = code || 1; return }
    const api = run(['scripts/local-docdb-api.mjs'], { PICKUP_DOCDB_SIM_PORT: '3010', PICKUP_DOCDB_SIM_FILE: 'showcase.json' })
    const web = run(['node_modules/vite/bin/vite.js', '--mode', 'docdb-local', '--host', '127.0.0.1', '--port', '5190', '--strictPort'], { PICKUP_DOCDB_DEV_PROXY: 'http://127.0.0.1:3010' })
    for (const child of [api, web]) child.on('exit', code => { for (const other of [api, web]) if (other !== child) other.kill(); process.exitCode = code || 0 })
  })
})
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => { for (const child of children) child.kill() })
