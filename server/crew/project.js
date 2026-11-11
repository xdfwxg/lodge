import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { homedir } from 'node:os'

export const PROJECT_FILE = 'LODGE.md'
export const MAX_PROJECT_BYTES = 20_000
const LAYER_FILES = [PROJECT_FILE, 'AGENTS.md', 'CLAUDE.md']
const MAX_LAYERS = 12

// 约束分层：最近的目录先，同一目录 LODGE.md 先于 AGENTS.md/CLAUDE.md；不越过 home。
export const readConstraintLayers = source => {
  if (typeof source !== 'string' || source.trim() === '') return []
  const home = resolve(homedir())
  let dir = resolve(source)
  const root = parse(dir).root
  const layers = []
  const seen = new Set()
  for (let depth = 0; depth < 8; depth += 1) {
    for (const name of LAYER_FILES) {
      const file = join(dir, name)
      if (seen.has(file) || !existsSync(file)) continue
      try {
        if (!statSync(file).isFile()) continue
        const content = readFileSync(file, 'utf8').slice(0, MAX_PROJECT_BYTES)
        seen.add(file)
        layers.push({ name, path: file, content, contentLength: content.length })
      } catch {}
    }
    if (layers.length >= MAX_LAYERS) break
    if (dir === root || dir === home) break
    const parent = dirname(dir)
    if (parent === dir) break
    if (resolve(parent) === home) break
    dir = parent
  }
  return layers
}

export const readProjectConstraints = source => {
  const layers = readConstraintLayers(source)
  if (layers.length === 0) return null
  let budget = MAX_PROJECT_BYTES
  const parts = []
  for (const layer of layers) {
    if (budget <= 0) break
    const text = layer.content.slice(0, budget)
    budget -= text.length
    parts.push(`## 来源：${layer.path}\n${text.trim()}`)
  }
  return {
    path: layers[0].path,
    content: parts.join('\n\n').slice(0, MAX_PROJECT_BYTES),
    layers: layers.map(({ name, path, contentLength }) => ({ name, path, bytes: contentLength })),
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
