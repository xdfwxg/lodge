import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { runCommand } from './acceptance.js'
import { roomDir, roomRootOf, workspaceRoot } from './paths.js'
import { writeConclusion, writeDiagnostic, writeGoal, writeProgress } from './room-repo.js'
import { writeMemberEnv } from './member-env.js'
import { createRoomMemory } from './memory.js'
import { defaultWorkspace, workspaceById, workspaceProvider } from './workspace.js'
import { captureHtml } from './screenshot.js'

// 应用层只依赖这组端口；具体存储/工作区/运行时实现只在组合根装配。
export const createCrewPorts = ({ memoryRoot, browserMcp = null, attachments = null } = {}) => ({
  browserMcp,
  attachments,
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
  commands: {
    run: runCommand,
  },
  files: {
    exists: path => existsSync(path),
    read: path => readFileSync(path),
    list: path => readdirSync(path),
    isDirectory: path => statSync(path).isDirectory(),
    mtimeMs: path => statSync(path).mtimeMs,
    remove: path => rmSync(path, { recursive: true, force: true }),
  },
})
