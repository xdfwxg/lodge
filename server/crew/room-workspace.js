import { writeSeatEnv } from './seat-env.js'
import { defaultWorkspace, workspaceById } from './workspace.js'

export const resolveWorkspaceProvider = ({ body, workspace, requestedRepo, sourceRepo }) => {
  const explicitWorkspace = typeof body.workspaceProvider === 'string' ? body.workspaceProvider.trim() : ''
  let provider = workspace
  if (provider === null) {
    if (explicitWorkspace !== '') {
      provider = workspaceById(explicitWorkspace)
      if (provider === undefined) return { error: '未知的工作区类型' }
    } else if (requestedRepo === '') {
      provider = defaultWorkspace
    } else {
      const gitProbe = defaultWorkspace.probeSource({ source: sourceRepo })
      const directProbe = workspaceById('direct').probeSource({ source: sourceRepo })
      provider = gitProbe.ok ? defaultWorkspace : directProbe.ok ? workspaceById('direct') : defaultWorkspace
    }
  }
  if (provider === undefined) return { error: '未知的工作区类型' }
  if (requestedRepo !== '' && provider.id === 'plain') {
    const probe = provider.probeSource({ source: sourceRepo })
    if (!probe.ok) return { error: probe.error }
  }
  return { provider }
}

export const prepareWorkspace = ({ provider, sourceRepo, short, roster }) => {
  let workspaces
  try {
    workspaces = provider.prepareRoom({ source: sourceRepo, short, seats: roster })
  } catch (error) {
    // git / 磁盘 / 权限问题不是用户的业务拒绝；交给组合根显式 500。
    throw new Error(`工作区不可用：${error?.message ?? error}`)
  }
  const roomId = `room-${short}`
  for (const seat of roster) {
    const seatPath = workspaces.seats[seat.id]?.path
    if (typeof seatPath === 'string') {
      writeSeatEnv({ room: { id: roomId }, seatId: seat.id, path: seatPath, port: workspaces.ports?.[seat.id] })
    }
  }
  if (workspaces.integration?.path !== undefined) {
    writeSeatEnv({ room: { id: roomId }, seatId: 'integration', path: workspaces.integration.path, port: workspaces.ports?.integration })
  }
  return workspaces
}
