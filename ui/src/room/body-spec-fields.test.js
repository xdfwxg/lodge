import assert from 'node:assert/strict'
import test from 'node:test'
import { bodySpecOf, bodySpecPayload } from './body-spec-fields.js'

test('a member body spec becomes editable text fields', () => {
  const spec = bodySpecOf({
    body: {
      spec: {
        prompt: '新纪律',
        skills: ['review', 'test'],
        mcp: [{ server: 'github' }],
      },
    },
  })
  assert.equal(spec.prompt, '新纪律')
  assert.equal(spec.skillsText, 'review, test')
  assert.equal(spec.mcpText, 'github')
  assert.deepEqual(bodySpecOf({}), { prompt: '', skillsText: '', mcpText: '' })
})

test('text fields become a normalized payload', () => {
  assert.deepEqual(bodySpecPayload({
    prompt: '纪律',
    skillsText: 'review, test',
    mcpText: 'github',
  }), {
    prompt: '纪律',
    skills: ['review', 'test'],
    mcp: ['github'],
  })
  assert.deepEqual(bodySpecPayload({ prompt: '', skillsText: '', mcpText: '' }), {
    prompt: '',
    skills: [],
    mcp: [],
  })
})
