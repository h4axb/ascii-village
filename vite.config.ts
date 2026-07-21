import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Cloudflare's REST API sends no CORS headers (it's built for
      // server/CLI use, not direct browser calls) — the dev server forwards
      // the request server-side instead, so the browser never sees the
      // cross-origin block. See src/imageGen.ts for the matching client code.
      '/cf-ai': {
        target: 'https://api.cloudflare.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cf-ai/, ''),
      },
    },
  },
});
