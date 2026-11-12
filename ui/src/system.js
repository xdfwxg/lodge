export const chooseDirectory = async () => {
  const picker = globalThis.lodge?.chooseDirectory
  if (typeof picker === 'function') {
    const picked = await picker()
    return typeof picked === 'string' && picked.trim() !== '' ? picked : null
  }
  const response = await fetch('/api/system/choose-directory', { method: 'POST' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? '选择目录失败')
  return typeof data.path === 'string' && data.path.trim() !== '' ? data.path : null
}

export const openPath = async target => {
  const opener = globalThis.lodge?.openPath
  if (typeof opener === 'function') {
    const result = await opener(target)
    if (result?.ok === false) throw new Error(result.error ?? '打开失败')
    return
  }
  const response = await fetch('/api/system/open-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: target }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? '打开失败')
}
