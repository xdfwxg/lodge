// Lodge 自己的主题令牌：只有界面实际用到的那一层，不依赖 vendored UI。
const BASE = {
  '--bt-text-body': '14px',
  '--bt-leading-body': '22px',
  '--bt-tracking-body': '0',
  '--bt-text-label': '13px',
  '--bt-text-helper': '12px',
  '--bt-focus-ring-w': '2px',
  '--bt-focus-ring-offset': '3px',
  '--bt-control-h-sm': '28px',
  '--bt-control-h': '32px',
  '--bt-control-h-lg': '36px',
  '--bt-space-1': '4px',
  '--bt-space-2': '8px',
  '--bt-space-3': '12px',
  '--bt-space-4': '16px',
  '--bt-space-5': '24px',
  '--bt-space-6': '32px',
  '--bt-ease': 'cubic-bezier(.2,.8,.2,1)',
  '--bt-radius-control': '6px',
  '--bt-radius-card': '12px',
  '--bt-radius-sheet': '16px',
  '--bt-dur-fast': '.12s',
  '--bt-dur-slow': '.2s',
  '--bt-font': 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "PingFang TC", "Hiragino Sans", "Apple SD Gothic Neo", "Microsoft YaHei", sans-serif',
  '--bt-leading-label': '20px',
  '--bt-leading-helper': '18px',
  '--bt-text-section': '14px',
  '--bt-leading-section': '22px',
  '--bt-text-title': '20px',
  '--bt-leading-title': '26px',
  '--bt-text-hero': '26px',
  '--bt-leading-hero': '32px',
  '--bt-tracking-meta': '.01em',
  '--bt-tracking-title': '-.01em',
  '--bt-tracking-hero': '-.02em',
  '--bt-font-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

const LIGHT = {
  ...BASE,
  '--bt-main': '#f3f3f3',
  '--bt-bg': '#f3f3f3',
  '--bt-sidebar': '#f3f3f3',
  '--bt-chat-bg': '#f3f3f3',
  '--bt-card': '#fcfcfc',
  '--bt-bubble': '#fcfcfc',
  '--bt-out-bubble': '#EFEFEF',
  '--bt-out-bubble-ink': '#141414',
  '--bt-ink': '#141414',
  '--bt-ink-2': 'rgba(20,20,20,.6)',
  '--bt-ink-3': '#5C6470',
  '--bt-line': 'rgba(20,20,20,.08)',
  '--bt-line-2': 'rgba(20,20,20,.15)',
  '--bt-hover': 'rgba(119,119,119,.09)',
  '--bt-active': 'rgba(119,119,119,.17)',
  '--bt-accent': '#3A55D9',
  '--bt-accent-ink': '#ffffff',
  '--bt-user': '#070707',
  '--bt-user-ink': '#fcfcfc',
  '--bt-tag-bg': 'rgba(20,20,20,.06)',
  '--bt-tag-ink': '#565E6A',
  '--bt-green': '#00c972',
  '--bt-star': '#ff9800',
  '--bt-danger': '#e02135',
  '--bt-danger-soft': '#FBE0E3',
  '--bt-input-bg': 'transparent',
  '--bt-ink-4': '#6B7280',
  '--bt-accent-text': '#2F4AB5',
  '--bt-focus-ring': '#2F4AB5',
  '--bt-danger-text': '#B3261E',
  '--bt-success-text': '#0B6B3A',
  '--bt-warning-text': '#8F4E00',
  // Solid blends that replace color-mix() at runtime: ink shades, washes, chips, lines.
  '--bt-shade-1': '#FAFAFA',
  '--bt-shade-2': '#F6F6F6',
  '--bt-shade-3': '#EFEFEF',
  '--bt-shade-4': '#EAEAEA',
  '--bt-scrollbar-thumb': '#D3D3D3',
  '--bt-success-wash': '#F0FCF7',
  '--bt-danger-wash': '#FDEDEF',
  '--bt-warning-wash': '#FFF6E8',
  '--bt-result-bg': '#FFF8EC',
  '--bt-result-line': '#E8D5AE',
  '--bt-accent-wash': '#EFF1FC',
  '--bt-topic-bg': '#E5ECFF',
  '--bt-topic-shadow': '0 2px 10px rgba(90,110,180,.12)',
  '--bt-success-soft': '#DBF7EB',
  '--bt-warning-soft': '#FFF2DE',
  '--bt-line-success': '#88D5B4',
  '--bt-line-danger': '#DE8891',
  '--bt-line-accent': '#ABB3DB',
  '--bt-line-warning': '#EEB969',
  '--bt-island-shadow': '0 10px 30px rgba(0,0,0,.10)',
  '--bt-elev-1': '0 1px 2px rgba(20,20,20,.05), 0 3px 10px rgba(20,20,20,.06)',
  '--bt-elev-2': '0 8px 28px rgba(20,20,20,.14), 0 1px 3px rgba(20,20,20,.07)',
  '--bt-elev-3': '0 24px 64px rgba(20,20,20,.22), 0 2px 8px rgba(20,20,20,.10)',
  '--bt-alt-row': '#F4F5F6',
  '--bt-line-control': 'rgba(20,20,20,.48)',
}

const DARK = {
  ...BASE,
  '--bt-main': '#181818',
  '--bt-bg': '#181818',
  '--bt-sidebar': '#181818',
  '--bt-chat-bg': '#181818',
  '--bt-card': '#1f1f1f',
  '--bt-bubble': '#2b2b2b',
  '--bt-out-bubble': '#2E2E2E',
  '--bt-out-bubble-ink': '#F2F2F2',
  '--bt-ink': '#f2f2f2',
  '--bt-ink-2': 'rgba(242,242,242,.6)',
  '--bt-ink-3': '#96A0AE',
  '--bt-line': 'rgba(255,255,255,.08)',
  '--bt-line-2': 'rgba(255,255,255,.15)',
  '--bt-hover': 'rgba(160,160,160,.12)',
  '--bt-active': 'rgba(160,160,160,.2)',
  '--bt-accent': '#3B5BDB',
  '--bt-accent-ink': '#ffffff',
  '--bt-user': '#f2f2f2',
  '--bt-user-ink': '#141414',
  '--bt-tag-bg': 'rgba(255,255,255,.09)',
  '--bt-tag-ink': '#9AA4B2',
  '--bt-green': '#00c972',
  '--bt-star': '#ffa726',
  '--bt-danger': '#ff5a6a',
  '--bt-danger-soft': '#472A2D',
  '--bt-input-bg': 'transparent',
  '--bt-ink-4': '#8A93A0',
  '--bt-accent-text': '#A8BCFF',
  '--bt-focus-ring': '#A8BCFF',
  '--bt-danger-text': '#FF98A3',
  '--bt-success-text': '#6CD6A2',
  '--bt-warning-text': '#E8AE63',
  // Solid blends that replace color-mix() at runtime: ink shades, washes, chips, lines.
  '--bt-shade-1': '#232323',
  '--bt-shade-2': '#272727',
  '--bt-shade-3': '#2E2E2E',
  '--bt-shade-4': '#323232',
  '--bt-scrollbar-thumb': '#3D3D3D',
  '--bt-success-wash': '#1D2D26',
  '--bt-danger-wash': '#352527',
  '--bt-warning-wash': '#382E20',
  '--bt-result-bg': '#2B251B',
  '--bt-result-line': '#5C4B2D',
  '--bt-accent-wash': '#222532',
  '--bt-topic-bg': '#242C48',
  '--bt-topic-shadow': '0 2px 10px rgba(0,0,0,.35)',
  '--bt-success-soft': '#1A3A2C',
  '--bt-warning-soft': '#433520',
  '--bt-line-success': '#277352',
  '--bt-line-danger': '#954B52',
  '--bt-line-accent': '#3E476E',
  '--bt-line-warning': '#A37532',
  '--bt-island-shadow': '0 10px 30px rgba(0,0,0,.35)',
  '--bt-elev-1': '0 1px 2px rgba(0,0,0,.35), 0 3px 10px rgba(0,0,0,.28)',
  '--bt-elev-2': '0 8px 28px rgba(0,0,0,.50), 0 1px 3px rgba(0,0,0,.32)',
  '--bt-elev-3': '0 24px 64px rgba(0,0,0,.60), 0 2px 8px rgba(0,0,0,.38)',
  '--bt-alt-row': '#242628',
  '--bt-line-control': 'rgba(255,255,255,.38)',
}

const declarations = vars => Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(';')

const themeCss = () => [
  `:root{${declarations(LIGHT)}}`,
  `body[data-ds-dark-theme]{${declarations(DARK)}}`,
].join('\n')

export const applyTheme = () => {
  const style = document.createElement('style')
  style.dataset.crewTheme = ''
  style.textContent = themeCss()
  document.head.append(style)
}

const THEME_KEY = 'lodge.theme'

export const themePreference = () => {
  try {
    const value = globalThis.localStorage?.getItem(THEME_KEY) ?? ''
    return value === 'dark' || value === 'light' ? value : null
  } catch {
    return null
  }
}

export const paintTheme = () => {
  const preference = themePreference()
  const dark = preference === null
    ? globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true
    : preference === 'dark'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  return dark ? 'dark' : 'light'
}

export const setThemePreference = value => {
  const next = value === 'dark' || value === 'light' ? value : null
  try {
    if (next === null) globalThis.localStorage?.removeItem(THEME_KEY)
    else globalThis.localStorage?.setItem(THEME_KEY, next)
  } catch {}
  paintTheme()
  return next
}

export const installTheme = () => {
  paintTheme()
  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
  const onChange = () => { if (themePreference() === null) paintTheme() }
  media?.addEventListener?.('change', onChange)
  return () => media?.removeEventListener?.('change', onChange)
}
