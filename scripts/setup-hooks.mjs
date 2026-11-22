// 把仓库内的 .githooks 接到当前 checkout；npm install 后自动执行，也可手动 npm run setup:hooks。
import { chmodSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const inside = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' })

if (inside.status !== 0) {
  console.log('setup-hooks: 不在 git checkout 里，跳过')
  process.exit(0)
}

const hook = resolve(root, '.githooks', 'pre-commit')
if (!existsSync(hook)) {
  console.error('setup-hooks: .githooks/pre-commit 不存在')
  process.exit(1)
}
chmodSync(hook, 0o755)

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
console.log('setup-hooks: pre-commit 已接到 .githooks/pre-commit')
