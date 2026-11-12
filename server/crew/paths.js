import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const workspaceRoot = () => (
  process.env.CREW_WORKSPACE_ROOT === undefined
    ? join(homedir(), 'CrewWorkspaces')
    : resolve(process.env.CREW_WORKSPACE_ROOT)
)

const gitToplevel = () => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

// CREW_REPO 是手动房间的默认仓库；实时房间用自己的 repoPath。
export const projectRoot = resolve(process.env.CREW_REPO ?? gitToplevel() ?? process.cwd())

// 房间记录落点；roomRoot 不要求是 git 仓库。repoPath 是已存房间的兼容字段名。
export const roomRootOf = room => {
  if (typeof room === 'string' || room === undefined || room === null) return projectRoot
  return typeof room.repoPath === 'string' && room.repoPath !== '' ? resolve(room.repoPath) : projectRoot
}

export const roomIdOf = room => (typeof room === 'string' ? room : room?.id)

export const crewRoot = room => join(roomRootOf(room), '.crew')

export const roomDir = room => join(crewRoot(room), 'rooms', roomIdOf(room))
