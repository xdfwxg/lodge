import { createElement as h } from 'react'
import { profileInitial } from './profile.js'

// 默认的“你”用一个人形，而不是把“你”字写两遍（头像一次、名字一次）。
export function ProfileMark({ profile }) {
  if (typeof profile?.avatar === 'string' && profile.avatar !== '') {
    return h('img', { src: profile.avatar, alt: '' })
  }
  const name = typeof profile?.name === 'string' ? profile.name.trim() : ''
  if (name !== '' && name !== '你') return profileInitial(profile)
  return h('svg', {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    'aria-hidden': 'true',
  },
  h('circle', { cx: 12, cy: 8.5, r: 3.6 }),
  h('path', { d: 'M5 20c0-3.8 3.4-5.7 7-5.7s7 1.9 7 5.7' }))
}
