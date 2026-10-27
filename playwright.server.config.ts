import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir:'./tests/server-e2e',fullyParallel:false,workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:5175',viewport:{width:1440,height:1000}},
  projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'edge',use:{browserName:'chromium',channel:'msedge'}},
    ...(process.env.PICKUP_TEST_FIREFOX === 'true' ? [{name:'firefox',use:{browserName:'firefox' as const}}] : [])],
  webServer:[
    {command:'node scripts/local-api.mjs',url:'http://127.0.0.1:3002/health',reuseExistingServer:false,env:{MYSQL_DATABASE:'pickup_browser_test',PICKUP_LOCAL_API_PORT:'3002'}},
    {command:'npm run dev:server -- --port 5175 --strictPort',url:'http://127.0.0.1:5175',reuseExistingServer:false,env:{PICKUP_DEV_PROXY:'http://127.0.0.1:3002'}},
  ],
})
