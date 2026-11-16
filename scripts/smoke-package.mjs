import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const at = args.indexOf('--app')
const platformAt = args.indexOf('--platform')
const platform = platformAt >= 0 ? args[platformAt + 1] : 'darwin'
const app = resolve(at >= 0 ? args[at + 1] : 'release/mac-arm64/Lodge.app')
const mac = platform === 'darwin'
const resources = mac ? join(app, 'Contents', 'Resources') : join(app, 'resources')
const binary = mac ? join(app, 'Contents', 'MacOS', 'Lodge') : join(app, platform === 'win32' ? 'Lodge.exe' : 'lodge')
const runtimeBinary = platform === 'win32' ? 'pi.exe' : 'pi'
const required = [
  'app/server/index.js',
  'app/shared/system-policy.js',
  'app/ui/dist/index.html',
  'base/dist-server/openmausbot.js',
  `runtimes/pi/${runtimeBinary}`,
  'licenses/third_party/OpenMausBot-LICENSE.txt',
]
for (const file of required) {
  if (!existsSync(join(resources, file))) throw new Error(`missing packaged file: ${file}`)
}

const dataDir = mkdtempSync(join(tmpdir(), 'lodge-package-smoke-'))
const port = 8788
const child = spawn(binary, [join(resources, 'app', 'server', 'index.js')], {
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
      if (response.ok) {
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
