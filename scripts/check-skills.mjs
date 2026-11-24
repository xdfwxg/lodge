// 技能包的结构门禁：文件与角色工具箱一一对应，frontmatter 可安装，
// 技能里点名的 gate 工具必须真的存在。行为质量仍由真实评测负责。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOLBOX_SKILLS } from '../shared/role-toolbox.js'
import { GATE_TOOLS } from '../server/crew/gate/mcp-server.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = join(root, 'skills', 'role-packs')
const failures = []
const toolNames = new Set(GATE_TOOLS.map(tool => tool.name))

const folders = readdirSync(dir)
  .filter(name => statSync(join(dir, name)).isDirectory())
  .sort()

for (const name of TOOLBOX_SKILLS) {
  if (!folders.includes(name)) failures.push(`角色工具箱里的 ${name} 没有对应技能包`)
}
for (const name of folders) {
  if (!TOOLBOX_SKILLS.includes(name)) failures.push(`技能包 ${name} 没有被任何角色引用`)
}

for (const name of folders) {
  const file = join(dir, name, 'SKILL.md')
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    failures.push(`${name}: 缺少 SKILL.md`)
    continue
  }
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (frontmatter === null) {
    failures.push(`${name}: 缺少 frontmatter`)
    continue
  }
  if (!new RegExp(`^name: ${name}$`, 'm').test(frontmatter[1])) failures.push(`${name}: name 与目录不一致`)
  if (!/^description: .+/m.test(frontmatter[1])) failures.push(`${name}: description 为空`)
  if (!/^license: MIT$/m.test(frontmatter[1])) failures.push(`${name}: license 必须是 MIT`)
  if (Buffer.byteLength(text) > 2400) failures.push(`${name}: 超过 2400 字节`)
  if (!/^## /m.test(text)) failures.push(`${name}: 没有可读的章节标题`)

  for (const match of text.matchAll(/(?:lodge_gate[_:]|mcp__lodge_gate__)([a-z_]+)/g)) {
    if (!toolNames.has(match[1])) failures.push(`${name}: 引用了不存在的 gate 工具 ${match[1]}`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✘ ${failure}`)
  process.exit(1)
}
console.log(`skills: ok（${folders.length} 个技能包，${TOOLBOX_SKILLS.length} 个角色引用）`)
