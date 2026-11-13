import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runCommand } from './acceptance.js'
import { handoffStore } from './handoff-store.js'
import { roomDir, roomRootOf, workspaceRoot } from './paths.js'
import { readBrief, writeBrief, writeConclusion, writeGoal } from './room-repo.js'
import { writeSeatEnv } from './seat-env.js'
import { MAX_PROJECT_BYTES, PROJECT_FILE, readProjectConstraints } from './project.js'
import { aggregateUsage, readUsageHistory, recordUsage } from './usage-history.js'
import { createSkillStore } from './skill-store.js'
import { deleteSavedRoomTemplate, listSavedRoomTemplates, saveSavedRoomTemplate } from './room-template-store.js'
import { deleteSavedTemplate, listSavedTemplates, saveSavedTemplate } from './template-store.js'
import { defaultWorkspace, workspaceById, workspaceProvider } from './workspace.js'

// 应用层只依赖这组端口；具体存储/工作区/运行时实现只在组合根装配。
export const createCrewPorts = () => ({
  roomFiles: {
    readBrief,
    writeBrief,
    writeGoal,
    writeConclusion,
    roomDir,
    roomRootOf,
  },
  workspace: {
    provider: workspaceProvider,
    byId: workspaceById,
    default: defaultWorkspace,
    root: workspaceRoot,
    writeSeatEnv,
    exists: path => existsSync(path),
    remove: path => rmSync(path, { recursive: true, force: true }),
  },
  project: {
    read: readProjectConstraints,
    file: PROJECT_FILE,
    maxBytes: MAX_PROJECT_BYTES,
  },
  usage: {
    record: recordUsage,
    read: readUsageHistory,
    aggregate: aggregateUsage,
  },
  templates: {
    list: listSavedTemplates,
    save: saveSavedTemplate,
    delete: deleteSavedTemplate,
  },
  roomTemplates: {
    list: listSavedRoomTemplates,
    save: saveSavedRoomTemplate,
    delete: deleteSavedRoomTemplate,
  },
  skills: createSkillStore({ dir: fileURLToPath(new URL('../../templates/skills/', import.meta.url)) }),
  commands: {
    run: runCommand,
  },
  handoff: handoffStore,
  files: {
    exists: path => existsSync(path),
    read: path => readFileSync(path),
    list: path => readdirSync(path),
    isDirectory: path => statSync(path).isDirectory(),
    mtimeMs: path => statSync(path).mtimeMs,
    remove: path => rmSync(path, { recursive: true, force: true }),
  },
})
