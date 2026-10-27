import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const formal = mode === 'docdb-formal'
  const cloudbase = mode === 'docdb-cloud' || formal
  if (cloudbase && (env.VITE_CLOUDBASE_ENV_ID || env.VITE_CLOUDBASE_PUBLISHABLE_KEY) && env.PICKUP_ENABLE_CLOUD !== 'true') throw new Error('展示版默认禁止连接云环境；仅在自行准备的隔离环境中显式启用 PICKUP_ENABLE_CLOUD=true')
  for (const key of ['PICKUP_DOCDB_DEV_PROXY', 'PICKUP_DEV_PROXY', 'VITE_PICKUP_API']) {
    if (env[key]) {
      if (key === 'VITE_PICKUP_API' && /^\/(?![\\/])/.test(env[key])) continue
      let url: URL
      try { url = new URL(env[key]) } catch { throw new Error('本地展示代理只允许回环地址') }
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('本地展示代理只允许回环地址')
    }
  }
  const docdb = cloudbase || mode === 'docdb' || mode === 'docdb-local'
  const server = docdb || mode === 'server' || (mode !== 'demo' && env.VITE_PICKUP_MODE === 'server')
  const real = fileURLToPath(new URL('./src/data/roster.json', import.meta.url))
  const demo = true // Public showcase never embeds an optional local real roster.
  return {
    plugins: [react(), tailwindcss()],
    define: { __PICKUP_FORMAL__: JSON.stringify(formal), __PICKUP_DEMO__: JSON.stringify(demo), __PICKUP_SERVER__: JSON.stringify(server), __PICKUP_REVISION_SYNC__:JSON.stringify(docdb), __PICKUP_DOCDB_SIMULATION__:JSON.stringify(mode==='docdb-local'), __PICKUP_CLOUDBASE__:JSON.stringify(cloudbase), __PICKUP_API__: JSON.stringify(cloudbase ? `cloudbase:${env.VITE_CLOUDBASE_ENV_ID}:${env.VITE_CLOUDBASE_PICKUP_FUNCTION}` : env.VITE_PICKUP_API || '/api/pickup') },
    server: cloudbase ? undefined : docdb ? {proxy:{'/api/pickup':{target:env.PICKUP_DOCDB_DEV_PROXY || 'http://127.0.0.1:3003'}}} : server && env.PICKUP_DEV_PROXY ? { proxy: { '/api/pickup': { target: env.PICKUP_DEV_PROXY } } } : undefined,
    resolve: { alias: { '@pickup-roster': server ? fileURLToPath(new URL('./src/data/server-roster.json', import.meta.url)) : demo ? fileURLToPath(new URL('./src/data/demo-roster.json', import.meta.url)) : real, '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  }
})
