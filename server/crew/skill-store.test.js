import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSkillStore } from './skill-store.js'

test('skills are read by id and listed without bodies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-skills-'))
  try {
    writeFileSync(join(dir, 'review.md'), '# 证据复核\n先看命令退出码，再看 diff。\n')
    const store = createSkillStore({ dir })
    assert.equal(store.has('review'), true)
    assert.deepEqual(store.catalog(), [{ id: 'review', name: '证据复核', description: '先看命令退出码，再看 diff。' }])
    assert.match(store.read('review').body, /先看命令退出码/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('skill ids cannot escape the skill directory', () => {
  const store = createSkillStore({ dir: '/tmp/lodge-skills-none' })
  assert.equal(store.read('../secret'), null)
  assert.equal(store.has('missing'), false)
  assert.deepEqual(store.catalog(), [])
})
