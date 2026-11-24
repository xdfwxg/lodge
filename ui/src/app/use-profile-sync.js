import { useEffect, useState } from 'react'
import { loadProfile } from '../profile.js'

// 服务端资料是全局真相；本地只负责首屏。
export const useProfileSync = serverProfile => {
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

  return [profile, setProfile]
}
