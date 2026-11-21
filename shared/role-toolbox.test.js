import assert from 'node:assert/strict'
import test from 'node:test'
import { ROLE_TOOLBOX, TOOLBOX_SKILLS, mergeRoleSkills, skillsForRole } from './role-toolbox.js'

test('each role has a small, distinct toolbox', () => {
  assert.equal(skillsForRole('lead').length, 2)
  assert.equal(skillsForRole('worker').length, 3)
  assert.equal(skillsForRole('verifier').length, 3)
  assert.equal(TOOLBOX_SKILLS.length, 7)
  for (const name of TOOLBOX_SKILLS) {
    assert.match(name, /^lodge-[a-z0-9-]+$/)
  }
  assert.equal(new Set(TOOLBOX_SKILLS).size, TOOLBOX_SKILLS.length)
  for (const role of ['lead', 'worker', 'verifier']) {
    assert.ok(skillsForRole(role).length <= 4, `${role} keeps at most four skills`)
  }
})

test('role skills are always present and custom skills use the remaining slots', () => {
  assert.deepEqual(mergeRoleSkills('lead', ['evidence-review']), [
    ...ROLE_TOOLBOX.lead,
    'evidence-review',
  ])
  assert.deepEqual(mergeRoleSkills('worker', ['evidence-review']), [
    ...ROLE_TOOLBOX.worker,
    'evidence-review',
  ])
})

test('merging keeps eight skills and drops invalid names', () => {
  const result = mergeRoleSkills('lead', ['ok', 'bad name', 'ok', ...Array.from({ length: 8 }, (_, index) => `extra-${index}`)])
  assert.equal(result.length, 8)
  assert.equal(result.includes('bad name'), false)
  assert.equal(result.filter(name => name === 'ok').length, 1)
  assert.equal(result[0], ROLE_TOOLBOX.lead[0])
})

test('merged and renamed role skills do not linger as custom skills', () => {
  assert.deepEqual(mergeRoleSkills('verifier', ['lodge-code-review-2', 'lodge-two-axis-review', 'lodge-verify-before-done', 'custom-review']), [
    ...ROLE_TOOLBOX.verifier,
    'custom-review',
  ])
  assert.deepEqual(mergeRoleSkills('worker', ['lodge-tdd', 'lodge-incremental', 'lodge-build']), ROLE_TOOLBOX.worker)
})

test('participants do not inherit a studio toolbox', () => {
  assert.deepEqual(skillsForRole('participant'), [])
  assert.deepEqual(mergeRoleSkills('participant', ['only-custom']), [])
})
