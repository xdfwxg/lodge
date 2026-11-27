// 打包只带我们自己构建的 Rust 基座：cargo build，然后把二进制放进 build/base-rs。
// 发布只发 macOS：二进制按本机目标架构构建，不交叉编译。
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const profile = process.env.LODGE_BASE_RS_PROFILE === 'debug' ? 'debug' : 'release'
const name = process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice'
const cargo = process.env.CARGO_BIN ?? 'cargo'
const path = [
  join(process.env.HOME ?? '', '.cargo', 'bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
  process.env.PATH ?? '',
].filter(Boolean).join(':')

execFileSync(cargo, [
  'build',
  '--manifest-path', join(root, 'base-rs', 'Cargo.toml'),
  ...(profile === 'release' ? ['--release'] : []),
], { stdio: 'inherit', env: { ...process.env, PATH: path } })

const built = join(root, 'base-rs', 'target', profile, name)
if (!existsSync(built)) {
  console.error(`没有找到构建产物：${built}`)
  process.exit(1)
}
const destRoot = join(root, 'build', 'base-rs')
rmSync(destRoot, { recursive: true, force: true })
mkdirSync(destRoot, { recursive: true })
const dest = join(destRoot, name)
copyFileSync(built, dest)
chmodSync(dest, 0o755)
console.log(`base bundled: ${destRoot} (${profile})`)
