import { workspaceProvider } from './workspace.js'

export const workspaceOf = room => workspaceProvider(room)

export const vcsOf = room => workspaceOf(room).capabilities().vcs ?? 'none'
