import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeRoomTemplate } from './room-templates.js'

const dirOf = dataDir => join(dataDir, 'room-templates')

export const listSavedRoomTemplates = dataDir => {
  if (typeof dataDir !== 'string' || dataDir === '') return []
  const dir = dirOf(dataDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => {
      try {
        return normalizeRoomTemplate(JSON.parse(readFileSync(join(dir, name), 'utf8')))
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export const saveSavedRoomTemplate = ({ dataDir, template }) => {
  if (typeof dataDir !== 'string' || dataDir === '') throw new Error('服务未配置 dataDir')
  const normalized = normalizeRoomTemplate(template)
  mkdirSync(dirOf(dataDir), { recursive: true })
  writeFileSync(join(dirOf(dataDir), `${normalized.id}.json`), JSON.stringify(normalized, null, 2))
  return normalized
}

export const deleteSavedRoomTemplate = ({ dataDir, id }) => {
  if (typeof dataDir !== 'string' || dataDir === '') throw new Error('服务未配置 dataDir')
  const file = join(dirOf(dataDir), `${id}.json`)
  if (!existsSync(file)) return false
  unlinkSync(file)
  return true
}
