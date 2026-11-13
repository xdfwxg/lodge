import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const ID = /^[\w-]{1,64}$/
const MAX_BODY = 12_000
const MAX_DESCRIPTION = 160

const parseSkill = (id, text) => {
  const lines = text.split('\n')
  const heading = lines.find(line => line.startsWith('# ')) ?? ''
  const name = heading.slice(2).trim() || id
  const description = lines
    .map(line => line.trim())
    .find(line => line !== '' && !line.startsWith('#') && line !== '---') ?? ''
  return {
    id,
    name: name.slice(0, 80),
    description: description.slice(0, MAX_DESCRIPTION),
    body: text.slice(0, MAX_BODY),
  }
}

// 可选能力库：正文只在派发时按声明读取；房型 SOP 不走这里。
export const createSkillStore = ({ dir }) => {
  const root = resolve(dir)
  const withinRoot = file => file === root || file.startsWith(`${root}${sep}`)
  const read = id => {
    if (!ID.test(id)) return null
    const file = resolve(root, `${id}.md`)
    if (!withinRoot(file) || !existsSync(file)) return null
    try {
      return parseSkill(id, readFileSync(file, 'utf8'))
    } catch {
      return null
    }
  }
  const catalog = () => {
    if (!existsSync(root)) return []
    try {
      return readdirSync(root)
        .filter(name => name.endsWith('.md'))
        .map(name => read(name.slice(0, -3)))
        .filter(Boolean)
        .map(({ id, name, description }) => ({ id, name, description }))
        .sort((a, b) => a.id.localeCompare(b.id))
    } catch {
      return []
    }
  }
  return { read, catalog, has: id => read(id) !== null }
}
