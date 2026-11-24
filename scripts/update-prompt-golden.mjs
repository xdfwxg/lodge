// 提示词快照的唯一更新入口；改完必须自己读一遍 diff。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promptSamples } from '../server/crew/prompt-golden.js'

const dir = fileURLToPath(new URL('../server/crew/fixtures/prompts/', import.meta.url))
mkdirSync(dir, { recursive: true })
for (const sample of promptSamples()) {
  writeFileSync(join(dir, `${sample.name}.txt`), sample.text)
}
console.log(`prompt golden updated: ${promptSamples().length} 份`)
