import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const candidates = [
  process.env.LODGE_BASE_DIST,
  join(root, '..', 'crew-chat-base', 'dist-server'),
].filter(item => typeof item === 'string' && item !== '')

const source = candidates.find(item => existsSync(join(item, 'openmausbot.js')))
if (source === undefined) {
  console.error('没有找到基座 dist-server。先在 crew-chat-base 里运行 pnpm build:server，或用 LODGE_BASE_DIST 指定目录。')
  process.exit(1)
}

const destRoot = join(root, 'build', 'base')
const dest = join(destRoot, 'dist-server')
rmSync(destRoot, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(source, dest, { recursive: true })

const baseRoot = dirname(source)
for (const name of ['LICENSE', 'NOTICE', 'LICENSING.md']) {
  const file = join(baseRoot, name)
  if (existsSync(file)) cpSync(file, join(destRoot, name))
}

console.log(`base bundled: ${destRoot}`)
