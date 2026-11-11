import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { installLocale } from './dsbot/client/i18n.js'
import { CONVERSATION_CSS, SHELL_CSS, installStyles } from './dsbot/client/styles.js'
import { allThemes, themeCss } from './dsbot/client/themes.js'
import { createLocale } from './locale.js'
import { App } from './app.js'
import './app.css'
import './crew.css'

installLocale(createLocale(navigator.language))
document.documentElement.lang = 'zh-CN'

for (const [tag, text] of [
  ['shell', SHELL_CSS],
  ['conversation', CONVERSATION_CSS],
]) installStyles(text, tag)

const dark = matchMedia('(prefers-color-scheme: dark)')
const paint = () => { document.body.toggleAttribute('data-ds-dark-theme', dark.matches) }
paint()
dark.addEventListener('change', paint)

const theme = allThemes().deepseek
const style = document.createElement('style')
style.textContent = themeCss(theme)
document.head.append(style)

createRoot(document.getElementById('root')).render(h(App))
