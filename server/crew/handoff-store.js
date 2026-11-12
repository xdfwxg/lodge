import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { roomDir } from './paths.js'

const read = (room, names) => {
  const dir = roomDir(room)
  const files = {}
  for (const name of names) {
    const file = join(dir, name)
    if (existsSync(file)) files[name] = readFileSync(file, 'utf8')
  }
  const evidenceDir = join(dir, 'evidence')
  if (existsSync(evidenceDir)) {
    for (const name of readdirSync(evidenceDir).sort()) {
      if (!/^[\w-]+\.json$/.test(name)) continue
      files[`evidence/${name}`] = readFileSync(join(evidenceDir, name), 'utf8')
    }
  }
  return files
}

export const handoffStore = { read }
