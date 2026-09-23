import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by Vercel as static files under /admin; the API is the same origin
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  build: { outDir: '../public/admin', emptyOutDir: true },
  server: {
    proxy: { '/pm-admin': 'http://localhost:3000' },
  },
});
