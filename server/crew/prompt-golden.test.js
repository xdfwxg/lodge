import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promptSamples } from './prompt-golden.js'

const dir = fileURLToPath(new URL('./fixtures/prompts/', import.meta.url))

// 固定的是“模型实际看到什么”，不是某个函数长什么样。
// 有意改提示词时跑 npm run prompts:update，并把 diff 当行为变化审一遍。
test('key prompts keep the wording the rooms were tuned against', () => {
  for (const sample of promptSamples()) {
    const file = join(dir, `${sample.name}.txt`)
    const expected = readFileSync(file, 'utf8')
    assert.equal(sample.text, expected, `${sample.name} 变了；确认行为后再运行 npm run prompts:update`)
  }
})

test('the golden set covers every room engine', () => {
  const names = promptSamples().map(sample => sample.name)
  assert.deepEqual(names, [
    'chat-host-natural',
    'chat-host-structured',
    'chat-speaker-first',
    'chat-speaker-follow',
    'chat-conclusion-review',
    'studio-alignment',
    'studio-worker-package',
  ])
})
