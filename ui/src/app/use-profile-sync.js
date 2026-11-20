import { useEffect, useState } from 'react'
import { loadProfile } from '../profile.js'

// 服务端资料是全局真相；本地只负责首屏和把旧浏览器资料迁上去。
export const useProfileSync = (store, serverProfile) => {
  const [profile, setProfile] = useState(loadProfile)

  useEffect(() => {
    const next = serverProfile
    if (next === undefined || next === null) return
    const name = typeof next.name === 'string' && next.name !== '' ? next.name : '你'
    const avatar = next.avatar ?? null
    setProfile(current => (
      current.name === name && current.avatar === avatar ? current : { name, avatar }
    ))
  }, [serverProfile?.name, serverProfile?.avatar])

  useEffect(() => {
    if (serverProfile === undefined || serverProfile === null) return
    const local = loadProfile()
    const serverName = typeof serverProfile.name === 'string' ? serverProfile.name : ''
    const serverAvatar = serverProfile.avatar ?? null
    if (serverName === '' && local.name !== '你' && local.name !== '') {
      void store.saveProfile({ name: local.name, avatar: local.avatar })
      return
    }
    if (serverAvatar === null && local.avatar !== null) {
      void store.saveProfile({ name: serverName || '你', avatar: local.avatar })
    }
  }, [serverProfile?.name, serverProfile?.avatar, store])

  return [profile, setProfile]
}
