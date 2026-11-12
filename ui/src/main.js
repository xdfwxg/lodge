import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { applyTheme } from './theme.js'
import { App } from './app.js'
import '@fontsource-variable/inter/wght.css'
import './app.css'
import './crew.css'

document.documentElement.lang = 'zh-CN'
applyTheme()

const dark = matchMedia('(prefers-color-scheme: dark)')
const paint = () => { document.body.toggleAttribute('data-ds-dark-theme', dark.matches) }
paint()
dark.addEventListener('change', paint)

createRoot(document.getElementById('root')).render(h(App))
