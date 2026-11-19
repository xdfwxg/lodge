const PROFILE_KEY = 'lodge.profile'

export const emptyProfile = () => ({ name: '你', avatar: null })

export const loadProfile = () => {
  try {
    const raw = globalThis.localStorage?.getItem(PROFILE_KEY)
    if (typeof raw !== 'string' || raw === '') return emptyProfile()
    const value = JSON.parse(raw)
    const name = typeof value?.name === 'string' && value.name.trim() !== '' ? value.name.trim().slice(0, 20) : '你'
    const avatar = typeof value?.avatar === 'string' && value.avatar.startsWith('data:image/') ? value.avatar : null
    return { name, avatar }
  } catch {
    return emptyProfile()
  }
}

export const saveProfile = profile => {
  const name = typeof profile?.name === 'string' && profile.name.trim() !== '' ? profile.name.trim().slice(0, 20) : '你'
  const avatar = typeof profile?.avatar === 'string' && profile.avatar.startsWith('data:image/') ? profile.avatar : null
  try {
    globalThis.localStorage?.setItem(PROFILE_KEY, JSON.stringify({ name, avatar }))
  } catch {
    // 存不下头像时只影响下次打开；当前这一屏仍然用新值。
  }
  return { name, avatar }
}

export const profileInitial = profile => (
  typeof profile?.name === 'string' && profile.name.trim() !== '' ? profile.name.trim().slice(0, 1) : '你'
)

// 头像在本地裁成 128px 方图再存，避免把整张照片塞进 localStorage。
export const readAvatar = file => new Promise((resolve, reject) => {
  if (file === null || file === undefined || !String(file.type ?? '').startsWith('image/')) {
    reject(new Error('选一张图片'))
    return
  }
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('这张图片读不了'))
  reader.onload = () => {
    const image = new Image()
    image.onerror = () => reject(new Error('这张图片读不了'))
    image.onload = () => {
      const size = 128
      const side = Math.min(image.width, image.height)
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (context === null) {
        reject(new Error('这张图片读不了'))
        return
      }
      context.drawImage(
        image,
        Math.max(0, (image.width - side) / 2),
        Math.max(0, (image.height - side) / 2),
        side,
        side,
        0,
        0,
        size,
        size,
      )
      resolve(canvas.toDataURL('image/jpeg', 0.86))
    }
    image.src = String(reader.result)
  }
  reader.readAsDataURL(file)
})
