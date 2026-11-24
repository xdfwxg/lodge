import { createElement as h, useEffect, useRef, useState } from 'react'
import { emailPresetOf } from '../../shared/email-presets.js'
import { useOverlay } from './overlay.js'
import { Segmented } from './segmented.js'
import { readAvatar } from './profile.js'
import { ProfileMark } from './profile-mark.js'
import { setThemePreference, themePreference } from './theme.js'

const currentTheme = () => themePreference()
  ?? (document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light')

// 本地身份不是登录：换头像、改名字、挑黑白主题，改完就生效。
export function ProfileDialog({ open, profile, store = null, onClose, onSave }) {
  const [name, setName] = useState(profile.name)
  const [avatar, setAvatar] = useState(profile.avatar)
  const [theme, setTheme] = useState(currentTheme)
  const [note, setNote] = useState('')
  const [email, setEmail] = useState(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailNote, setEmailNote] = useState('')
  const [emailTone, setEmailTone] = useState('')
  const [tested, setTested] = useState(false)
  // 最近一次读回或保存成功的邮箱草稿；「完成」会先保存这份改动，避免填完直接关掉时丢掉。
  const [emailSaved, setEmailSaved] = useState(null)
  const fileRef = useRef(null)
  const overlay = useOverlay({ label: '你', onClose, active: open })

  useEffect(() => {
    if (!open) return
    setName(profile.name)
    setAvatar(profile.avatar)
    setTheme(currentTheme())
    setNote('')
  }, [open, profile.name, profile.avatar])

  useEffect(() => {
    if (!open || store === null) return undefined
    let active = true
    void store.emailSettings().then(settings => {
      if (!active) return
      setEmail(settings)
      if (settings?.configured === true) {
        setFrom(settings.from ?? '')
        setTo(settings.to ?? '')
        setEmailSaved({ from: settings.from ?? '', to: settings.to ?? '' })
      } else {
        setPassword('')
        setFrom('')
        setTo('')
        setEmailSaved(null)
      }
    })
    return () => { active = false }
  }, [open, store])

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
  const emailDirty = emailOpen && (from.trim() !== '' || password !== '') && (
    password !== '' ||
    emailSaved === null ||
    from !== emailSaved.from ||
    to !== emailSaved.to
  )
  // 一个弹窗只留一个决定：填了邮箱就先把邮箱保存掉，再关窗；保存失败就停在原地给原因。
  const done = async () => {
    if (emailBusy) return
    if (emailDirty && !(await saveEmail())) return
    onSave({ name, avatar })
    onClose()
  }
  const field = (label, input, wide = false) => h('label', {
    className: `crew-settings-field${wide ? ' crew-settings-field-wide' : ''}`,
  }, h('span', null, label), input)
  const inputOf = (value, onChange, props = {}) => h('input', {
    className: 'crew-goal-input',
    value,
    onChange: event => onChange(event.target.value),
    ...props,
  })
  const saveEmail = async () => {
    if (store === null) return false
    setEmailBusy(true)
    setEmailNote('')
    // 服务器地址由服务端按发件邮箱推断；界面只交地址和密码。
    const result = await store.saveEmailSettings({ from, password, to })
    setEmailBusy(false)
    if (result.ok !== true) {
      setEmailNote(result.error ?? '没保存上')
      setEmailTone('error')
      setEmailOpen(true)
      return false
    }
    const saved = result.settings ?? {}
    setEmail(saved)
    setPassword('')
    setEmailNote('已保存')
    setEmailTone('')
    setTested(false)
    setEmailSaved({ from: String(saved.from ?? from), to: String(saved.to ?? to) })
    return true
  }
  const testEmail = async () => {
    if (store === null) return
    // 测试前先保存：填完直接点「测试」，不用先找保存按钮。
    if (emailDirty && !(await saveEmail())) return
    setEmailBusy(true)
    setEmailNote('')
    const result = await store.testEmail({ to })
    setEmailBusy(false)
    setTested(result.ok === true)
    setEmailTone(result.ok === true ? 'ok' : 'error')
    setEmailNote(result.ok === true ? `已发到 ${result.to}` : (result.error ?? '没发出去'))
  }
  const clearEmail = async () => {
    if (store === null) return
    const result = await store.clearEmailSettings()
    if (result.ok !== true) {
      setEmailNote(result.error ?? '没断开')
      return
    }
    setEmail(result.settings)
    setPassword('')
    setEmailNote('已断开')
  }
  const emailStatus = email === null
    ? '读取中…'
    : emailDirty ? '还没保存' : email.configured === true ? `已连接 · ${email.from}` : '还没连接'
  const preset = emailPresetOf(from)
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
      h('div', { className: 'crew-profile-section' },
        h('div', { className: 'crew-profile-row crew-profile-row-flat' },
          h('span', { className: 'crew-profile-label' }, '邮箱'),
          h('span', { className: 'crew-profile-value' }, emailStatus),
          h('button', {
            type: 'button',
            className: 'crew-link',
            onClick: () => setEmailOpen(value => !value),
          }, emailOpen ? '收起' : (email?.configured === true ? '修改' : '连接'))),
        emailOpen
          ? h('div', { className: 'crew-settings-form' },
            h('div', { className: 'crew-settings-fields' },
              field('发件邮箱', inputOf(from, setFrom, { placeholder: 'name@example.com', type: 'email' })),
              field('应用密码', inputOf(password, setPassword, {
                type: 'password',
                placeholder: email?.configured === true ? '留空保留已保存的密码' : '授权码 / 应用密码',
              }))),
            from.trim() === ''
              ? null
              : preset !== null
                ? h('div', { className: 'crew-email-known' },
                  h('span', { className: 'crew-email-known-dot', 'aria-hidden': 'true' }),
                  h('span', null, `已识别 ${preset.label}`))
                : h('p', { className: 'crew-field-hint' }, '没认出这家邮箱；先用 126、163、QQ、Gmail、Outlook 这类常见邮箱。'),
            preset?.hint === undefined
              ? null
              : h('p', { className: 'crew-field-hint' }, preset.hint),
            emailNote === '' ? null : h('p', {
              className: 'crew-email-status',
              role: 'status',
              'data-tone': emailTone === '' ? 'muted' : emailTone,
            }, emailNote),
            h('div', { className: 'crew-settings-actions' },
              h('button', {
                type: 'button',
                className: 'crew-ghost crew-email-test',
                'data-ok': tested ? 'true' : 'false',
                disabled: emailBusy || from.trim() === '',
                onClick: () => void testEmail(),
              }, emailBusy ? '测试中…' : (tested ? '测试通过' : '测试')),
              email?.configured === true
                ? h('button', { type: 'button', className: 'crew-link', disabled: emailBusy, onClick: () => void clearEmail() }, '断开')
                : null))
          : null),
      note === '' ? null : h('p', { className: 'crew-field-hint', role: 'alert' }, note)),
    h('div', { className: 'crew-dialog-foot crew-profile-foot' },
      h('button', {
        type: 'button',
        className: emailDirty ? 'crew-accept crew-dialog-primary' : 'crew-ghost',
        autoFocus: true,
        disabled: emailBusy,
        onClick: done,
      }, emailBusy ? '保存中…' : (emailDirty ? '保存并关闭' : '完成')))))
}
