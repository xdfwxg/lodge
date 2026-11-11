// Crew Chat 自己的主题令牌：只有界面实际用到的那一层，不依赖 vendored UI。
const LIGHT = {
  '--bt-main': '#fcfcfc',
  '--bt-bg': '#fcfcfc',
  '--bt-sidebar': '#f7f7f7',
  '--bt-card': '#ffffff',
  '--bt-bubble': '#eeeeee',
  '--bt-ink': '#141414',
  '--bt-ink-2': 'rgba(20,20,20,.6)',
  '--bt-ink-3': 'rgba(20,20,20,.36)',
  '--bt-line': 'rgba(20,20,20,.08)',
  '--bt-line-2': 'rgba(20,20,20,.15)',
  '--bt-hover': 'rgba(119,119,119,.09)',
  '--bt-active': 'rgba(119,119,119,.17)',
  '--bt-accent': '#4d6bfe',
  '--bt-accent-ink': '#ffffff',
  '--bt-user': '#070707',
  '--bt-user-ink': '#fcfcfc',
  '--bt-tag-bg': 'rgba(20,20,20,.06)',
  '--bt-tag-ink': 'rgba(20,20,20,.58)',
  '--bt-green': '#00c972',
  '--bt-star': '#ff9800',
  '--bt-danger': '#e02135',
  '--bt-danger-soft': 'rgba(224,33,53,.14)',
  '--bt-input-bg': 'transparent',
  '--bt-font': '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
}

const DARK = {
  '--bt-main': '#141414',
  '--bt-bg': '#141414',
  '--bt-sidebar': '#1b1b1b',
  '--bt-card': '#1f1f1f',
  '--bt-bubble': '#262626',
  '--bt-ink': '#f2f2f2',
  '--bt-ink-2': 'rgba(242,242,242,.6)',
  '--bt-ink-3': 'rgba(242,242,242,.36)',
  '--bt-line': 'rgba(255,255,255,.08)',
  '--bt-line-2': 'rgba(255,255,255,.15)',
  '--bt-hover': 'rgba(160,160,160,.12)',
  '--bt-active': 'rgba(160,160,160,.2)',
  '--bt-accent': '#5b7bff',
  '--bt-accent-ink': '#ffffff',
  '--bt-user': '#f2f2f2',
  '--bt-user-ink': '#141414',
  '--bt-tag-bg': 'rgba(255,255,255,.09)',
  '--bt-tag-ink': 'rgba(242,242,242,.62)',
  '--bt-green': '#00c972',
  '--bt-star': '#ffa726',
  '--bt-danger': '#ff5a6a',
  '--bt-danger-soft': 'rgba(255,90,106,.18)',
  '--bt-input-bg': 'transparent',
}

const declarations = vars => Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(';')

export const themeCss = () => [
  `:root{${declarations(LIGHT)}}`,
  `body[data-ds-dark-theme]{${declarations(DARK)}}`,
].join('\n')

export const applyTheme = () => {
  const style = document.createElement('style')
  style.dataset.crewTheme = ''
  style.textContent = themeCss()
  document.head.append(style)
}
