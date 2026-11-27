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
  const packs = join(root, 'skills', 'role-packs')
  const library = await openLibrary(client)
  const byName = new Map((library?.skills ?? []).map(skill => [skill.name, skill]))
  let imported = 0
  let approved = 0
  const replaced = []
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
      // 同名不覆盖是基座的默认（避免升级悄悄改掉旧会话的纪律）。角色包归 Lodge 所有，
      // 改过就删掉旧的再按新正文导入——旧的那份直接消失，不留两套真相。
      await client.deleteLibrarySkill(name)
      await client.importLibrarySkill(text)
      await client.approveLibrarySkill(name)
      replaced.push(name)
      continue
    }
    if (existing.enabled !== true) {
      await client.approveLibrarySkill(name)
      approved += 1
    }
  }
  log(`role skill packs: ${TOOLBOX_SKILLS.length} ready (${imported} imported, ${approved} approved${replaced.length === 0 ? '' : `, ${replaced.length} replaced`})`)
  return { total: TOOLBOX_SKILLS.length, imported, approved, replaced }
}
