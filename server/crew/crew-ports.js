import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { roomDir, roomRootOf, workspaceRoot } from './paths.js'
import { writeConclusion, writeDiagnostic, writeGoal, writeProgress } from './room-repo.js'
import { writeMemberEnv } from './member-env.js'
import { createRoomMemory } from './memory.js'
import { defaultWorkspace, workspaceById, workspaceProvider } from './workspace.js'
import { captureHtml } from './screenshot.js'
import { setCommandRunner } from './command-runner.js'

// 应用层只依赖这组端口；具体存储/工作区/运行时实现只在组合根装配。
export const createCrewPorts = ({
  memoryRoot,
  browserMcp = null,
  desktopMcp = null,
  attachments = null,
  roleSkills = { ready: () => true },
  runSandboxed = null,
} = {}) => {
  // 平台执行 agent 写的命令只有一个出口：基座的受限执行。
  if (typeof runSandboxed === 'function') {
    setCommandRunner(({ cwd, command }) => runSandboxed({ work: cwd, command }))
  }
  return {
  browserMcp,
  desktopMcp,
  attachments,
  roleSkills,
  screenshots: { capture: captureHtml },
  roomFiles: {
    writeGoal,
    writeProgress,
    writeConclusion,
    writeDiagnostic,
    roomDir,
    roomRootOf,
  },
  memory: createRoomMemory({ root: memoryRoot ?? join(process.cwd(), '.data', 'memory') }),
  workspace: {
    provider: workspaceProvider,
    byId: workspaceById,
    default: defaultWorkspace,
    root: workspaceRoot,
    writeMemberEnv,
    exists: path => existsSync(path),
    remove: path => rmSync(path, { recursive: true, force: true }),
  },
  files: {
    exists: path => existsSync(path),
    read: path => readFileSync(path),
    list: path => readdirSync(path),
    isDirectory: path => statSync(path).isDirectory(),
    mtimeMs: path => statSync(path).mtimeMs,
    remove: path => rmSync(path, { recursive: true, force: true }),
  },
  }
}
