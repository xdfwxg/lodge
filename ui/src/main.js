import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { applyTheme, installTheme } from './theme.js'
import { App } from './app.js'
import { installSummaryScrollGuard } from './summary-scroll.js'
import './app.css'
import './crew.css'

document.documentElement.lang = 'zh-CN'
applyTheme()
installTheme()

// Electron + macOS：hiddenInset 红绿灯区域给侧栏让位（纯浏览器不受影响）。
if (navigator.userAgent.includes('Electron') && /Mac/.test(navigator.platform)) {
  document.body.classList.add('is-mac-shell')
}

installSummaryScrollGuard()
createRoot(document.getElementById('root')).render(h(App))
