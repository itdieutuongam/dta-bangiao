import { defineConfig } from 'vitest/config';

// Test end-to-end: Worker production build chạy trên workerd (wrangler dev) + trình duyệt Chrome/Edge thật.
// Chạy qua `npm run test:e2e` (scripts/e2e/run-e2e.mjs khởi động môi trường và truyền biến E2E_*).
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    environment: 'node',
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
