import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { runCommand } from './acceptance.js'
import { roomDir, roomRootOf, workspaceRoot } from './paths.js'
import { writeConclusion, writeDiagnostic, writeGoal } from './room-repo.js'
import { writeMemberEnv } from './member-env.js'
import { defaultWorkspace, workspaceById, workspaceProvider } from './workspace.js'

// 应用层只依赖这组端口；具体存储/工作区/运行时实现只在组合根装配。
export const createCrewPorts = () => ({
  roomFiles: {
    writeGoal,
    writeConclusion,
    writeDiagnostic,
    roomDir,
    roomRootOf,
  },
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
