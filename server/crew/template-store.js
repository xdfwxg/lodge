import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const templatesDir = dataDir => join(dataDir, 'templates')
const isId = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)

export const listSavedTemplates = dataDir => {
  if (typeof dataDir !== 'string' || dataDir === '') return []
  const dir = templatesDir(dataDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => {
      try {
        const template = JSON.parse(readFileSync(join(dir, name), 'utf8'))
        return isId(template?.id) && Array.isArray(template?.seats) ? template : null
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export const saveSavedTemplate = ({ dataDir, template }) => {
  if (typeof dataDir !== 'string' || dataDir === '') throw new Error('服务未配置 dataDir')
  if (!isId(template?.id)) throw new Error('模板 id 不可用')
  if (!Array.isArray(template?.seats) || template.seats.length === 0) throw new Error('模板没有席位')
  const dir = templatesDir(dataDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${template.id}.json`), JSON.stringify(template, null, 2))
  return template
}

export const deleteSavedTemplate = ({ dataDir, id }) => {
  if (typeof dataDir !== 'string' || dataDir === '') throw new Error('服务未配置 dataDir')
  if (!isId(id)) throw new Error('模板 id 不可用')
  const file = join(templatesDir(dataDir), `${id}.json`)
  if (!existsSync(file)) return false
  unlinkSync(file)
  return true
}
