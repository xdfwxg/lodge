import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const primitives = fileURLToPath(new URL('./ui/src/primitives.js', import.meta.url))

// The Bot views ask for DSH's interface primitives; this window has no DSH, so its
// own module stands in for that one. Same trick as Claude-Bot's app/vite.config.js.
const ownPrimitives = {
  name: 'crew-primitives',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    return source === './dsh-primitives.js' && importer?.replaceAll('\\', '/').includes('/dsbot/client/')
      ? primitives
      : null
  },
}

export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  base: './',
  plugins: [ownPrimitives],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2048 },
})
