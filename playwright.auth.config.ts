import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests/auth-browser', workers: 1, use: { baseURL: 'http://127.0.0.1:5193', browserName: 'chromium' }, webServer: { command: 'npm run dev:docdb-formal -- --port 5193 --strictPort', url: 'http://127.0.0.1:5193', reuseExistingServer: false } })
