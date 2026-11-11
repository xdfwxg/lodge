import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  base: './',
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2048 },
})
