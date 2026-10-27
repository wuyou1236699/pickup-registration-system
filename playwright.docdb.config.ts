import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir:'./tests/docdb-e2e',fullyParallel:false,workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:5192',viewport:{width:1440,height:1000}},
  projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'edge',use:{browserName:'chromium',channel:'msedge'}}],
  webServer:[
    {command:'npm run build:docdb-local-tools && npm run api:docdb-local',url:'http://127.0.0.1:3012/health',reuseExistingServer:false,
      env:{PICKUP_DOCDB_SIM_PORT:'3012',PICKUP_DOCDB_SIM_FILE:`docdb-browser-${Date.now()}.json`}},
    {command:'npm run dev:docdb-local -- --port 5192 --strictPort',url:'http://127.0.0.1:5192',reuseExistingServer:false,env:{PICKUP_DOCDB_DEV_PROXY:'http://127.0.0.1:3012'}},
  ],
})
