import { createHash } from 'node:crypto'
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync,
  statSync, symlinkSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

// 非交付内容不复制、不进文件清单：版本控制与本地运行文件都不是交付物。
const EXAMPLE_ENV = new Set(['.env.example', '.env.sample', '.env.template'])
const isEnvName = name => name === '.env' || (name.startsWith('.env.') && !EXAMPLE_ENV.has(name))
const excludedName = name => (
  name === '.git' || name === '.crew' || name === '.lodge' || name === 'node_modules' || isEnvName(name)
)

const nodeModulesMode = () => {
  const mode = process.env.CREW_NODE_MODULES_MODE
  return ['copy', 'link', 'none'].includes(mode) ? mode : 'copy'
}

// 依赖默认复制而不是 symlink：共享源目录的 node_modules 会让一个工作区的写入穿过隔离。
export const syncLocalEnvironment = (source, target, { copyEnv = true, nodeModules = nodeModulesMode() } = {}) => {
  const copied = []
  const linked = []
  const warnings = []
  if (copyEnv) {
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
  }
  const from = join(source, 'node_modules')
  const to = join(target, 'node_modules')
  if (nodeModules !== 'none' && existsSync(from) && !existsSync(to)) {
    try {
      if (nodeModules === 'link') {
        symlinkSync(from, to, 'dir')
        linked.push('node_modules')
      } else {
        cpSync(from, to, { recursive: true, force: true })
      }
    } catch (error) {
      warnings.push(`node_modules: ${error?.message ?? error}`)
    }
  }
  return { copied, linked, warnings, nodeModules }
}

export const copyWorkspace = (source, target) => {
  cpSync(source, target, {
    recursive: true,
    filter: src => !excludedName(basename(src)),
  })
}

const hashOf = file => createHash('sha256').update(readFileSync(file)).digest('hex')

export const manifestOf = root => {
  const files = []
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      if (excludedName(name)) continue
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
  const from = join(source, path)
  // 清单里的软链只记录链接文本；复制内容会把工作区外的文件带进集成区。
  if (lstatSync(from).isSymbolicLink()) return false
  const to = join(target, path)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  return true
}
