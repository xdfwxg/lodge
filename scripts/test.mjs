import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { NODE_TEST_GLOBS } from './test-globs.mjs'

// 测试用独立的工作区根目录：不污染 ~/CrewWorktrees，也不和上一次测试的残留目录撞名。
const root = mkdtempSync(join(tmpdir(), 'lodge-test-'))
const env = {
  ...process.env,
  CREW_WORKTREE_ROOT: join(root, 'worktrees'),
  CREW_WORKSPACE_ROOT: join(root, 'workspaces'),
}

const result = spawnSync(process.execPath, ['--test', ...NODE_TEST_GLOBS], { stdio: 'inherit', env })

rmSync(root, { recursive: true, force: true })
process.exit(result.status ?? 1)
