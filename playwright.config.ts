import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests/e2e', fullyParallel: false, workers: 1, use: { baseURL: 'http://127.0.0.1:5191', browserName: 'chromium', viewport: { width: 1440, height: 1000 } }, webServer: { command: 'npm run dev:demo -- --port 5191 --strictPort', url: 'http://127.0.0.1:5191', reuseExistingServer: false } })
