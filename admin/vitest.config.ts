import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Specs run in a browser-like DOM; the app build is vite.config.ts
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['src/__tests__/setup.ts'],
    restoreMocks: true,
  },
});
