// 固定提示词的预算门禁：角色 soul + 技能包是每个成员每一回合都要付的钱。
// 只设上限，不管风格；删得动手是因为这一行数字会红，而不是因为谁记得住。
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLE_DEFINITIONS } from '../shared/role-definitions.js'
import { ROLE_TOOLBOX } from '../shared/role-toolbox.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 上限贴着 2026-11-27 删过一轮后的实测值，留一成左右的余量；再加东西就该问自己值不值。
const PACK_CAP = Object.freeze({
  'lodge-plan': 1700,
  'lodge-design': 1000,
  'lodge-build': 1050,
  'lodge-diagnose': 750,
  'lodge-ui': 1400,
  'lodge-review': 1600,
  'lodge-security': 1100,
})
const ROLE_CAP = Object.freeze({ lead: 3800, worker: 3400, verifier: 4300 })

let failed = false
const chars = path => readFileSync(join(root, path), 'utf8').length

for (const [pack, cap] of Object.entries(PACK_CAP)) {
  const size = chars(`skills/role-packs/${pack}/SKILL.md`)
  const state = size <= cap ? 'ok' : '超了'
  console.log(`${state}  ${pack}: ${size}/${cap}`)
  if (size > cap) failed = true
}

for (const [role, definition] of Object.entries(ROLE_DEFINITIONS)) {
  const packs = ROLE_TOOLBOX[role] ?? []
  const total = definition.prompt.length + packs.reduce((sum, pack) => sum + chars(`skills/role-packs/${pack}/SKILL.md`), 0)
  const cap = ROLE_CAP[role]
  const state = total <= cap ? 'ok' : '超了'
  console.log(`${state}  ${role}: ${total}/${cap}（soul ${definition.prompt.length} + ${packs.length} 个技能包）`)
  if (total > cap) failed = true
}

if (failed) {
  console.error('prompt budget: 固定的提示词变大了；删掉重复或代码已经强制的内容，或给出为什么值得多付这一份。')
  process.exit(1)
}
console.log('prompt budget: ok')
