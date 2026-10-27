import { defineConfig } from 'vitest/config'
export default defineConfig({test:{include:['tests/database/**/*.test.ts'],fileParallelism:false,testTimeout:20000,hookTimeout:20000}})
