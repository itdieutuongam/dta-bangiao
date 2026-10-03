import { defineConfig } from 'vitest/config';

// Unit/integration tests chạy trên Node (không cần workerd, không cần tài khoản Google/Cloudflare).
// Apps Script được kiểm thử qua bộ giả lập trong scripts/gas-emulator.
// Test end-to-end (Worker thật + trình duyệt) chạy riêng: npm run test:e2e
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
