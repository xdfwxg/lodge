import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const PROJECT_FILE = 'LODGE.md'
export const MAX_PROJECT_BYTES = 20_000

// 项目约束归人：仓库根的 LODGE.md，建房时快照进房间，不在运行时偷偷改。
export const readProjectConstraints = source => {
  if (typeof source !== 'string' || source.trim() === '') return null
  const root = resolve(source)
  const file = join(root, PROJECT_FILE)
  if (!existsSync(file)) return null
  try {
    const stat = statSync(file)
    if (!stat.isFile()) return null
    return { path: file, content: readFileSync(file, 'utf8').slice(0, MAX_PROJECT_BYTES) }
  } catch {
    return null
  }
}

export const projectConstraintLines = content => (
  String(content ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
    .map(line => line.replace(/^[-*]\s*/, '').slice(0, 300))
    .slice(0, 40)
)
