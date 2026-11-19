import { createElement as h, useEffect, useRef, useState } from 'react'
import { useOverlay } from './overlay.js'
import { Segmented } from './segmented.js'
import { readAvatar } from './profile.js'
import { ProfileMark } from './profile-mark.js'
import { setThemePreference, themePreference } from './theme.js'

const currentTheme = () => themePreference()
  ?? (document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light')

// 本地身份不是登录：换头像、改名字、挑黑白主题，改完就生效。
export function ProfileDialog({ open, profile, onClose, onSave }) {
  const [name, setName] = useState(profile.name)
  const [avatar, setAvatar] = useState(profile.avatar)
  const [theme, setTheme] = useState(currentTheme)
  const [note, setNote] = useState('')
  const fileRef = useRef(null)
  const overlay = useOverlay({ label: '你', onClose, active: open })

  useEffect(() => {
    if (!open) return
    setName(profile.name)
    setAvatar(profile.avatar)
    setTheme(currentTheme())
    setNote('')
  }, [open, profile.name, profile.avatar])

  if (!open) return null
  const pick = async event => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    if (file === null) return
    try {
      setAvatar(await readAvatar(file))
      setNote('')
    } catch (error) {
      setNote(String(error?.message ?? error))
    }
  }
  const done = () => {
    onSave({ name, avatar })
    onClose()
  }
  return h('div', { className: 'crew-overlay crew-overlay-center', onClick: onClose, ...overlay },
    h('div', {
      className: 'crew-dialog crew-profile',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '你',
      onClick: event => event.stopPropagation(),
    },
    h('div', { className: 'crew-profile-body' },
      h('div', { className: 'crew-profile-head' },
        h('button', {
          type: 'button',
          className: 'crew-profile-avatar',
          'aria-label': '换头像',
          title: '换头像',
          onClick: () => fileRef.current?.click(),
        },
        h(ProfileMark, { profile: { name, avatar } }),
        h('span', { className: 'crew-profile-avatar-hint', 'aria-hidden': 'true' },
          h('svg', {
            viewBox: '0 0 24 24',
            width: 18,
            height: 18,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.7,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', { d: 'M4 8.8h3.1l1.4-2.2h7l1.4 2.2H20v9.4H4z' }),
          h('circle', { cx: 12, cy: 13.2, r: 3.2 })))),
        h('div', { className: 'crew-profile-identity' },
          h('input', {
            className: 'crew-goal-input crew-profile-name',
            value: name,
            maxLength: 20,
            'aria-label': '你的名字',
            placeholder: '你的名字',
            onChange: event => setName(event.target.value),
          }),
          avatar === null
            ? null
            : h('div', { className: 'crew-profile-actions' },
              h('button', { type: 'button', className: 'crew-link', onClick: () => setAvatar(null) }, '用首字')),
          h('input', { ref: fileRef, type: 'file', accept: 'image/*', hidden: true, onChange: event => void pick(event) }))),
      h('div', { className: 'crew-profile-row' },
        h('span', { className: 'crew-profile-label' }, '主题'),
        h(Segmented, {
          label: '主题',
          options: [{ value: 'light', label: '白色' }, { value: 'dark', label: '黑色' }],
          value: theme,
          onChange: value => {
            setTheme(value)
            setThemePreference(value)
          },
        })),
      note === '' ? null : h('p', { className: 'crew-field-hint', role: 'alert' }, note)),
    h('div', { className: 'crew-dialog-foot crew-profile-foot' },
      h('button', { type: 'button', className: 'crew-accept crew-dialog-primary', autoFocus: true, onClick: done }, '完成'))))
}
