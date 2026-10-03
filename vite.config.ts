import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// Một lệnh `vite` chạy cả React SPA và Worker API (/api/*) trong workerd.
// `vite build` sinh dist/client (static assets) + dist/dta_handover (Worker)
// kèm wrangler.json đã chuyển hướng để `wrangler deploy` dùng trực tiếp.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
  },
});
