import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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

const write = (room, entries) => {
  const dir = roomDir(room)
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of entries) {
    const file = join(dir, name)
    mkdirSync(name.includes('/') ? join(dir, 'evidence') : dir, { recursive: true })
    writeFileSync(file, text)
  }
}

const archivePath = (dataDir, id) => join(dataDir, 'imported', id)

export const handoffStore = { read, write, archivePath }
