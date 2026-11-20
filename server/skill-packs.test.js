import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { TOOLBOX_SKILLS } from '../shared/role-toolbox.js'
import { ensureRoleSkillPacks } from './skill-packs.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const quiet = () => {}

const fakeClient = ({ enabled = true, conflict = false } = {}) => {
  const state = { skills: new Map(), texts: new Map(), patchConfig: 0, imports: 0, approvals: 0 }
  let open = enabled
  return {
    state,
    async skillsLibrary() {
      if (!open) {
        const error = new Error('base 404 /api/skills-library')
        throw error
      }
      return { skills: [...state.skills.values()] }
    },
    async patchConfig(payload) {
      state.patchConfig += 1
      state.config = payload
      open = true
    },
    async importLibrarySkill(text) {
      const name = /^name:\s*(.+)$/m.exec(text)?.[1].trim()
      state.imports += 1
      state.skills.set(name, { name, enabled: false })
      state.texts.set(name, text)
    },
    async approveLibrarySkill(name) {
      state.approvals += 1
      state.skills.set(name, { ...state.skills.get(name), name, enabled: true })
    },
    async readLibrarySkill(name) {
      if (conflict && name === TOOLBOX_SKILLS[0]) return { text: 'different' }
      return { text: state.texts.get(name) ?? `name: ${name}` }
    },
  }
}

test('every role skill has valid, matching frontmatter', () => {
  for (const name of TOOLBOX_SKILLS) {
    const text = readFileSync(join(root, 'skills', 'role-packs', name, 'SKILL.md'), 'utf8')
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)
    assert.ok(frontmatter, name)
    assert.match(frontmatter[1], new RegExp(`^name: ${name}$`, 'm'), name)
    assert.match(frontmatter[1], /^description: .+/m, name)
    assert.match(frontmatter[1], /^license: MIT$/m, name)
    assert.ok(Buffer.byteLength(text) < 64 * 1024, name)
  }
})

test('installs and approves every role skill once', async () => {
  const client = fakeClient()
  const first = await ensureRoleSkillPacks({ client, root, log: quiet })
  assert.equal(first.imported, TOOLBOX_SKILLS.length)
  assert.equal(first.approved, TOOLBOX_SKILLS.length)
  assert.equal(client.state.skills.size, TOOLBOX_SKILLS.length)

  const second = await ensureRoleSkillPacks({ client, root, log: quiet })
  assert.equal(second.imported, 0)
  assert.equal(second.approved, 0)
})

test('opens the base library when it is off', async () => {
  const client = fakeClient({ enabled: false })
  const result = await ensureRoleSkillPacks({ client, root, log: quiet })
  assert.equal(result.imported, TOOLBOX_SKILLS.length)
  assert.equal(client.state.patchConfig, 1)
})

test('refuses to overwrite a different user skill with the same name', async () => {
  const client = fakeClient({ conflict: true })
  client.state.skills.set(TOOLBOX_SKILLS[0], { name: TOOLBOX_SKILLS[0], enabled: true })
  await assert.rejects(
    ensureRoleSkillPacks({ client, root, log: quiet }),
    /内容不同/,
  )
})
