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

// 技能包可能比基座先醒来：成功后缓存，失败允许下一次建房再试；
// 同一时刻只跑一次安装，避免并发建房在技能库里来回覆盖。
export const createSkillPackGate = ({ ensure, log = console.warn }) => {
  let ready = false
  let task = null
  return () => {
    if (ready) return true
    if (task === null) {
      task = Promise.resolve()
        .then(ensure)
        .then(() => {
          ready = true
          return true
        })
        .catch(error => {
          log(`角色技能包没有准备好：${error?.message ?? error}`)
          return false
        })
        .finally(() => {
          task = null
        })
    }
    return task
  }
}

export const ensureRoleSkillPacks = async ({ client, root, log = console.log }) => {
  if (process.env.CREW_ROLE_SKILLS === 'off') return { skipped: true, total: TOOLBOX_SKILLS.length, conflicts: [] }
  const packs = join(root, 'skills', 'role-packs')
  const library = await openLibrary(client)
  const byName = new Map((library?.skills ?? []).map(skill => [skill.name, skill]))
  let imported = 0
  let approved = 0
  const conflicts = []
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
      // 基座不支持覆盖同名技能。技能已经存在且可用，不能因为文案漂移把建房拦住；
      // 记下冲突，继续用库里的版本，升级基座或人工处理后再更新。
      conflicts.push(name)
      log(`角色技能 ${name} 与基座里的同名技能内容不同；保留基座版本，不覆盖`)
      continue
    }
    if (existing.enabled !== true) {
      await client.approveLibrarySkill(name)
      approved += 1
    }
  }
  log(`role skill packs: ${TOOLBOX_SKILLS.length} ready (${imported} imported, ${approved} approved${conflicts.length === 0 ? '' : `, ${conflicts.length} kept from base`})`)
  return { skipped: false, total: TOOLBOX_SKILLS.length, imported, approved, conflicts }
}
