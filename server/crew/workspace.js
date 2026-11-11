import * as gitWorkspace from './workspace-git.js'
import * as plainWorkspace from './workspace-plain.js'

// Workspace 端口：业务只认 provider，不直接调用 git。git 是默认实现。
const providers = new Map()

export const registerWorkspaceProvider = (id, provider) => {
  providers.set(id, provider)
}

registerWorkspaceProvider(gitWorkspace.id, gitWorkspace)
registerWorkspaceProvider(plainWorkspace.id, plainWorkspace)

export const defaultWorkspace = gitWorkspace

export const workspaceById = id => providers.get(id)

export const workspaceProvider = room => {
  const id = room?.workspace?.provider ?? gitWorkspace.id
  const provider = providers.get(id)
  if (provider === undefined) throw new Error(`未知的工作区 provider：${id}`)
  return provider
}
