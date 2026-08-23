import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true },
  server: {
    port: 5173,
    // en dev el front pega al Fastify de al lado
    proxy: {
      '/api': 'http://localhost:8087',
      '/media': 'http://localhost:8087',
    },
  },
});
