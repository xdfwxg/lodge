import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLBOX_SKILLS } from '../shared/role-toolbox.js'

const isMissing = error => /base 404/.test(String(error?.message ?? error))
const sameText = (a, b) => String(a ?? '').trim() === String(b ?? '').trim()

const openLibrary = async client => {
  try {
    return await client.skillsLibrary()
  } catch (error) {
    if (!isMissing(error)) throw error
    await client.patchConfig({ features: { skillsLibrary: true } })
    return client.skillsLibrary()
  }
}

export const ensureRoleSkillPacks = async ({ client, root, log = console.log }) => {
  if (process.env.CREW_ROLE_SKILLS === 'off') return { skipped: true, total: TOOLBOX_SKILLS.length }
  const packs = join(root, 'skills', 'role-packs')
  const library = await openLibrary(client)
  const byName = new Map((library?.skills ?? []).map(skill => [skill.name, skill]))
  let imported = 0
  let approved = 0
  for (const name of TOOLBOX_SKILLS) {
    const text = readFileSync(join(packs, name, 'SKILL.md'), 'utf8')
    const existing = byName.get(name)
    if (existing === undefined) {
      await client.importLibrarySkill(text)
      await client.approveLibrarySkill(name)
      imported += 1
      approved += 1
      continue
    }
    const stored = await client.readLibrarySkill(name)
    if (!sameText(stored?.text, text)) {
      throw new Error(`角色技能 ${name} 与基座技能库里的同名技能内容不同；先处理这个冲突，不覆盖用户技能`)
    }
    if (existing.enabled !== true) {
      await client.approveLibrarySkill(name)
      approved += 1
    }
  }
  log(`role skill packs: ${TOOLBOX_SKILLS.length} ready (${imported} imported, ${approved} approved)`)
  return { skipped: false, total: TOOLBOX_SKILLS.length, imported, approved }
}
