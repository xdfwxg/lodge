import assert from 'node:assert/strict'
import test from 'node:test'
import { ROLE_TOOLBOX, TOOLBOX_SKILLS, mergeRoleSkills, skillsForRole } from './role-toolbox.js'

test('each role has a small, distinct toolbox', () => {
  assert.equal(skillsForRole('lead').length, 5)
  assert.equal(skillsForRole('worker').length, 6)
  assert.equal(skillsForRole('verifier').length, 6)
  assert.equal(TOOLBOX_SKILLS.length, 16)
  for (const name of TOOLBOX_SKILLS) {
    assert.match(name, /^lodge-[a-z0-9-]+$/)
  }
  assert.equal(new Set(TOOLBOX_SKILLS).size, TOOLBOX_SKILLS.length)
})

test('role skills are always present and custom skills are additive', () => {
  assert.deepEqual(mergeRoleSkills('worker', ['evidence-review']), [
    ...ROLE_TOOLBOX.worker,
    'evidence-review',
  ])
  assert.deepEqual(mergeRoleSkills('lead', ['lodge-grilling', 'custom']), [
    ...ROLE_TOOLBOX.lead,
    'custom',
  ])
})

test('merging keeps eight skills and drops invalid names', () => {
  const result = mergeRoleSkills('worker', ['ok', 'bad name', 'ok', ...Array.from({ length: 8 }, (_, index) => `extra-${index}`)])
  assert.equal(result.length, 8)
  assert.equal(result.includes('bad name'), false)
  assert.equal(result.filter(name => name === 'ok').length, 1)
  assert.equal(result[0], ROLE_TOOLBOX.worker[0])
})

test('participants do not inherit a studio toolbox', () => {
  assert.deepEqual(skillsForRole('participant'), [])
  assert.deepEqual(mergeRoleSkills('participant', ['only-custom']), [])
})
