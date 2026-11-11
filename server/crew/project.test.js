import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { projectConstraintLines, readConstraintLayers, readProjectConstraints } from './project.js'

test('project constraints come from the repository root LODGE.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-project-'))
  assert.equal(readProjectConstraints(root), null)
  writeFileSync(join(root, 'LODGE.md'), '# 项目约束\n\n- 用 ESM\n- 不改上游\n\n## 测试\nnpm test\n')
  const file = readProjectConstraints(root)
  assert.equal(file.path, join(root, 'LODGE.md'))
  assert.deepEqual(projectConstraintLines(file.content), ['用 ESM', '不改上游', 'npm test'])
})

test('nearer layers win and ancestor agent files are included', () => {
  const parent = mkdtempSync(join(tmpdir(), 'lodge-project-parent-'))
  const child = join(parent, 'repo')
  mkdirSync(child)
  writeFileSync(join(child, 'LODGE.md'), '# 项目\n- 用 ESM\n')
  writeFileSync(join(parent, 'AGENTS.md'), '# 上级\n- 提交前跑测试\n')
  const layers = readConstraintLayers(child)
  assert.deepEqual(layers.map(layer => layer.name), ['LODGE.md', 'AGENTS.md'])
  const merged = readProjectConstraints(child)
  assert.match(merged.content, /用 ESM/)
  assert.match(merged.content, /提交前跑测试/)
  assert.equal(merged.layers.length, 2)
})
