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
  LODGE_GATE_SPOOL: join(root, 'gate-spool'),
}

// 测试进程里的命令执行端口指向本地 exec（生产由组合根指向基座）。
const preload = new URL('./test-runner.mjs', import.meta.url).href
const result = spawnSync(process.execPath, ['--import', preload, '--test', ...NODE_TEST_GLOBS], { stdio: 'inherit', env })

rmSync(root, { recursive: true, force: true })
process.exit(result.status ?? 1)
