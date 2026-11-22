export const chooseDirectory = async () => {
  const picker = globalThis.lodge?.chooseDirectory
  if (typeof picker === 'function') {
    const picked = await picker()
    return typeof picked === 'string' && picked.trim() !== '' ? picked : null
  }
  const response = await fetch('/api/system/choose-directory', { method: 'POST' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? '文件夹没能选上')
  return typeof data.path === 'string' && data.path.trim() !== '' ? data.path : null
}

export const loginRuntime = async id => {
  const login = globalThis.lodge?.loginRuntime
  if (typeof login !== 'function') throw new Error('内置模型服务登录只支持 Lodge 桌面版')
  const result = await login(id)
  if (result?.ok === false) throw new Error(result.error ?? '没能打开登录')
}

export const openPath = async target => {
  const opener = globalThis.lodge?.openPath
  if (typeof opener === 'function') {
    const result = await opener(target)
    if (result?.ok === false) throw new Error(result.error ?? '没能打开')
    return
  }
  const response = await fetch('/api/system/open-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: target }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? '没能打开')
}

// 桌面桥的窄口：界面只通过这里发通知、同步菜单和订阅系统命令。
export const requestAttention = payload => globalThis.lodge?.attention?.(payload)
export const syncRoomMenu = rooms => globalThis.lodge?.syncRooms?.(rooms)
export const onOpenRoom = handler => globalThis.lodge?.onOpenRoom?.(handler) ?? null
