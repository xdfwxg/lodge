import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PLATFORM = process.env.LODGE_RUNTIME_PLATFORM ?? process.platform
const ARCH = process.env.LODGE_RUNTIME_ARCH ?? process.arch
const FORCE = process.argv.includes('--force')
const platformName = PLATFORM === 'win32' ? 'windows' : PLATFORM
const ext = PLATFORM === 'win32' ? 'zip' : 'tar.gz'
const root = process.cwd()
const cacheRoot = join(root, 'build', 'runtime-cache')
const runtimesRoot = join(root, 'build', 'runtimes')

const RUNTIMES = [
  {
    id: 'pi',
    name: 'Pi',
    version: '1.5.2',
    release: 'https://github.com/earendil-works/pi/releases/download/v{version}',
    checksums: 'SHA256SUMS',
    asset: 'pi-{platform}-{arch}.{ext}',
    archiveRoot: 'pi',
    binary: PLATFORM === 'win32' ? 'pi.exe' : 'pi',
    license: 'third_party/pi-LICENSE.txt',
  },
]

const expand = (template, runtime, version) => template
  .replaceAll('{version}', version)
  .replaceAll('{platform}', platformName)
  .replaceAll('{arch}', ARCH)
  .replaceAll('{ext}', ext)

const download = async (url, file) => {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`download ${url}: HTTP ${response.status}`)
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
}

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')

for (const runtime of RUNTIMES) {
  const version = process.env[`LODGE_RUNTIME_${runtime.id.toUpperCase()}_VERSION`] ?? runtime.version
  const destDir = join(runtimesRoot, runtime.id)
  const destBinary = join(destDir, runtime.binary)

  let current = null
  try {
    if (existsSync(destBinary)) current = JSON.parse(readFileSync(join(destDir, 'runtime.json'), 'utf8')).version
  } catch {}
  if (!FORCE && current === version) {
    if (runtime.license && !existsSync(join(destDir, 'LICENSE'))) {
      cpSync(join(root, runtime.license), join(destDir, 'LICENSE'))
    }
    writeFileSync(join(destDir, 'runtime.json'), JSON.stringify({
      id: runtime.id,
      name: runtime.name,
      version,
      binary: runtime.binary,
    }, null, 2) + '\n')
    console.log(`${runtime.id}: already bundled ${version}`)
    continue
  }

  const cacheDir = join(cacheRoot, runtime.id)
  const asset = expand(runtime.asset, runtime, version)
  const baseUrl = expand(runtime.release, runtime, version)
  const assetPath = join(cacheDir, asset)
  const sumsPath = join(cacheDir, runtime.checksums)
  mkdirSync(cacheDir, { recursive: true })
  if (!existsSync(assetPath) || !existsSync(sumsPath)) {
    console.log(`${runtime.id}: downloading ${version} (${asset})`)
    await download(`${baseUrl}/${runtime.checksums}`, sumsPath)
    await download(`${baseUrl}/${asset}`, assetPath)
  }

  const expected = readFileSync(sumsPath, 'utf8')
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .find(parts => parts[1] === asset)?.[0]
  if (expected === undefined) throw new Error(`${runtime.id}: ${runtime.checksums} does not list ${asset}`)
  const actual = sha256(assetPath)
  if (actual !== expected) throw new Error(`${runtime.id}: checksum mismatch for ${asset}`)

  const tmpDir = join(cacheDir, 'extract')
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
  execFileSync('tar', ['-xf', assetPath, '-C', tmpDir], { stdio: 'inherit' })
  const extracted = runtime.archiveRoot ? join(tmpDir, runtime.archiveRoot) : tmpDir
  if (!existsSync(join(extracted, runtime.binary))) {
    throw new Error(`${runtime.id}: ${asset} does not contain ${runtime.binary}`)
  }
  rmSync(destDir, { recursive: true, force: true })
  cpSync(extracted, destDir, { recursive: true })
  if (PLATFORM !== 'win32') chmodSync(destBinary, 0o755)
  if (runtime.license) cpSync(join(root, runtime.license), join(destDir, 'LICENSE'))
  writeFileSync(join(destDir, 'runtime.json'), JSON.stringify({
    id: runtime.id,
    name: runtime.name,
    version,
    binary: runtime.binary,
  }, null, 2) + '\n')
  rmSync(tmpDir, { recursive: true, force: true })
  console.log(`${runtime.id}: bundled ${version} at ${destDir}`)
}
