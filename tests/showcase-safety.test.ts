import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'

it('填写云参数但未明确启用时，正式构建拒绝运行', () => {
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'docdb-formal'], {
    encoding: 'utf8', env: { ...process.env, VITE_CLOUDBASE_ENV_ID: 'fictional-environment', VITE_CLOUDBASE_PUBLISHABLE_KEY: 'fictional-key', PICKUP_ENABLE_CLOUD: 'false' },
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('展示版默认禁止连接云环境')
}, 15000)

it.each(['https://fictional.example.invalid', '//fictional.example.invalid'])('本地展示拒绝非回环代理 %s，不请求外部地址', proxy => {
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'docdb-local'], {
    encoding: 'utf8', env: { ...process.env, PICKUP_DOCDB_DEV_PROXY: proxy },
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('本地展示代理只允许回环地址')
}, 15000)
