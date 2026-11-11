import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { projectConstraintLines, readProjectConstraints } from './project.js'

test('project constraints come from the repository root LODGE.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-project-'))
  assert.equal(readProjectConstraints(root), null)
  writeFileSync(join(root, 'LODGE.md'), '# 项目约束\n\n- 用 ESM\n- 不改上游\n\n## 测试\nnpm test\n')
  const file = readProjectConstraints(root)
  assert.equal(file.path, join(root, 'LODGE.md'))
  assert.deepEqual(projectConstraintLines(file.content), ['用 ESM', '不改上游', 'npm test'])
})
