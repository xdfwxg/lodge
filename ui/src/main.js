import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { applyTheme } from './theme.js'
import { App } from './app.js'
import { installSummaryScrollGuard } from './summary-scroll.js'
import './app.css'
import './crew.css'

document.documentElement.lang = 'zh-CN'
applyTheme()

// Electron + macOS：hiddenInset 红绿灯区域给侧栏让位（纯浏览器不受影响）。
if (navigator.userAgent.includes('Electron') && /Mac/.test(navigator.platform)) {
  document.body.classList.add('is-mac-shell')
}

const dark = matchMedia('(prefers-color-scheme: dark)')
const paint = () => { document.body.toggleAttribute('data-ds-dark-theme', dark.matches) }
paint()
dark.addEventListener('change', paint)

installSummaryScrollGuard()
createRoot(document.getElementById('root')).render(h(App))
