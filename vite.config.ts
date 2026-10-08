/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // relative base so the build can be hosted under any path (e.g. tatiyants.com/pev/)
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
});
