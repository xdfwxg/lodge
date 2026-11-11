import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseTemplate } from './template.js'

const yamlFile = fileURLToPath(new URL('../../templates/delivery-triad.crew.yaml', import.meta.url))

test('the built-in YAML template parses into three role seats', () => {
  const template = parseTemplate(readFileSync(yamlFile, 'utf8'), 'delivery-triad.crew.yaml')
  assert.equal(template.name, '交付三人组')
  assert.deepEqual(template.seats.map(seat => seat.role), ['lead', 'worker', 'verifier'])
  assert.equal(template.seats[1].prompt.includes('Executor'), true)
  assert.equal(template.seats[0].engine, undefined)
  assert.deepEqual(template.skippedHumans, ['你'])
})

test('a JSON template can set names, prompts and engines', () => {
  const template = parseTemplate(JSON.stringify({
    name: '单人调试',
    seats: [{ role: 'worker', name: '小工', engine: 'codex-cli', system_prompt: '只改一个文件' }],
  }), 'mini.json')
  assert.equal(template.seats[0].name, '小工')
  assert.equal(template.seats[0].engine, 'codex-cli')
  assert.equal(template.seats[0].prompt, '只改一个文件')
})

test('a template cannot grant more permissions than its role', () => {
  assert.throws(() => parseTemplate(JSON.stringify({
    name: '提权',
    seats: [{ role: 'verifier', name: '验收', permissions: ['read', 'exec', 'write'] }],
  }), 'bad.json'), /权限与角色不符/)
  assert.throws(() => parseTemplate(JSON.stringify({
    name: '没有执行',
    seats: [{ role: 'lead', name: '队长' }],
  }), 'bad.json'), /至少需要一个执行/)
})
