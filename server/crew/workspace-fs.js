import { createHash } from 'node:crypto'
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync,
  statSync, symlinkSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

// 非交付内容不复制、不进文件清单：版本控制与本地运行文件都不是交付物。
const EXCLUDED = new Set(['.git', '.crew', '.env', '.env.local', 'node_modules'])

export const syncLocalEnvironment = (source, target) => {
  const copied = []
  const linked = []
  const warnings = []
  for (const name of ['.env', '.env.local']) {
    const from = join(source, name)
    const to = join(target, name)
    if (!existsSync(from) || existsSync(to)) continue
    try {
      copyFileSync(from, to)
      chmodSync(to, statSync(from).mode & 0o777)
      copied.push(name)
    } catch (error) {
      warnings.push(`${name}: ${error?.message ?? error}`)
    }
  }
  for (const name of ['node_modules']) {
    const from = join(source, name)
    const to = join(target, name)
    if (!existsSync(from) || existsSync(to)) continue
    try {
      symlinkSync(from, to, 'dir')
      linked.push(name)
    } catch (error) {
      warnings.push(`${name}: ${error?.message ?? error}`)
    }
  }
  return { copied, linked, warnings }
}

export const copyWorkspace = (source, target) => {
  cpSync(source, target, {
    recursive: true,
    filter: src => !EXCLUDED.has(basename(src)),
  })
}

const hashOf = file => createHash('sha256').update(readFileSync(file)).digest('hex')

export const manifestOf = root => {
  const files = []
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      if (EXCLUDED.has(name)) continue
      const absolute = join(dir, name)
      const path = prefix === '' ? name : `${prefix}/${name}`
      let stat
      try {
        stat = lstatSync(absolute)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(absolute, path)
        continue
      }
      if (stat.isSymbolicLink()) {
        let link = ''
        try {
          link = readlinkSync(absolute)
        } catch {}
        files.push({ path, sha256: createHash('sha256').update(link).digest('hex'), bytes: 0 })
        continue
      }
      if (stat.isFile()) files.push({ path, sha256: hashOf(absolute), bytes: stat.size })
    }
  }
  if (existsSync(root)) walk(root, '')
  return files
}

export const manifestDigest = files => createHash('sha256').update(JSON.stringify(files)).digest('hex')

export const copyEntry = (source, target, path) => {
  const to = join(target, path)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(join(source, path), to)
}
