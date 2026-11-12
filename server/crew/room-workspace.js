export const resolveWorkspaceProvider = ({ body, workspace, requestedRepo, sourceRepo, workspacePort }) => {
  const explicitWorkspace = typeof body.workspaceProvider === 'string' ? body.workspaceProvider.trim() : ''
  let provider = workspace
  if (provider === null) {
    if (explicitWorkspace !== '') {
      provider = workspacePort.byId(explicitWorkspace)
      if (provider === undefined) return { error: '未知的工作区类型' }
    } else if (requestedRepo === '') {
      provider = workspacePort.default
    } else {
      const gitProbe = workspacePort.default.probeSource({ source: sourceRepo })
      const directProbe = workspacePort.byId('direct').probeSource({ source: sourceRepo })
      provider = gitProbe.ok ? workspacePort.default : directProbe.ok ? workspacePort.byId('direct') : workspacePort.default
    }
  }
  if (provider === undefined) return { error: '未知的工作区类型' }
  if (requestedRepo !== '' && provider.id === 'plain') {
    const probe = provider.probeSource({ source: sourceRepo })
    if (!probe.ok) return { error: probe.error }
  }
  return { provider }
}

export const prepareWorkspace = ({ provider, sourceRepo, short, roster, workspacePort }) => {
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
      workspacePort.writeSeatEnv({ room: { id: roomId }, seatId: seat.id, path: seatPath, port: workspaces.ports?.[seat.id] })
    }
  }
  if (workspaces.integration?.path !== undefined) {
    workspacePort.writeSeatEnv({ room: { id: roomId }, seatId: 'integration', path: workspaces.integration.path, port: workspaces.ports?.integration })
  }
  return workspaces
}
