import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { packageArgs, packageLayout } from './package-layout.mjs'

const { app: appPath, platform } = packageArgs(process.argv.slice(2))
const app = resolve(appPath)
const layout = packageLayout({ platform, app })
for (const file of layout.required) {
  if (!existsSync(join(layout.resources, file))) throw new Error(`missing packaged file: ${file}`)
}

const dataDir = mkdtempSync(join(tmpdir(), 'lodge-package-smoke-'))
const port = await new Promise((resolvePort, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const chosen = probe.address().port
    probe.close(() => resolvePort(chosen))
  })
})
const child = spawn(layout.binary, [join(layout.resources, 'app', 'server', 'index.js')], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    CREW_PORT: String(port),
    CREW_DATA_DIR: dataDir,
    CREW_BASE_URL: 'http://127.0.0.1:8799',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', chunk => { output += chunk.toString() })
child.stderr.on('data', chunk => { output += chunk.toString() })

try {
  const deadline = Date.now() + 30_000
  let healthy = false
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      const body = await response.json().catch(() => ({}))
      if (response.ok && body.server === 'lodge') {
        healthy = true
        break
      }
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 500))
  }
  if (!healthy) throw new Error(`packaged server did not answer\n${output}`)
  console.log('package smoke: ok')
} finally {
  child.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}
