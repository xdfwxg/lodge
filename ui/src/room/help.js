import { Fragment, createElement as h, useEffect, useState } from 'react'
import { useOverlay } from '../overlay.js'

const SEEN_KEY = 'lodge.seen-help'

export const helpSeen = () => {
  try { return globalThis.localStorage?.getItem(SEEN_KEY) === '1' } catch { return false }
}

const rememberSeen = () => {
  try { globalThis.localStorage?.setItem(SEEN_KEY, '1') } catch {}
}

export const HELP_TOPICS = [
  ['房间', '一件事一间房。房间结束不用删，收进「已归档」就好。'],
  ['聊天室', '成员像同事一样聊，聊多久、什么时候停，都由你决定。'],
  ['工作室', '说清你要的结果，Lodge 把它拆成几步；成员按步骤做，验收员看结果。'],
  ['换模式', '两种模式随时切换，成员跟着房间走，不用重新建。'],
  ['成员', '成员是接在本机模型上的机器人。在输入框里 @ 谁，就只有谁回答。'],
  ['进展', '房间里第一行那张卡写着第几步、谁在做、看到了什么证据，看不到进展就点开它。'],
]

export function RoomHelp({ autoOpen = false }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!autoOpen || helpSeen()) return
    setOpen(true)
    rememberSeen()
  }, [autoOpen])
  const close = () => setOpen(false)
  const overlay = useOverlay({ label: 'Lodge 怎么用', onClose: close, active: open })
  return h(Fragment, null,
    h('button', { type: 'button', className: 'crew-link', 'data-menu-keep': '', onClick: () => setOpen(true) }, '怎么用'),
    open
      ? h('div', { className: 'crew-overlay', onClick: close, ...overlay },
        h('div', {
          className: 'crew-dialog crew-help-dialog',
          onClick: event => event.stopPropagation(),
        },
        h('div', { className: 'crew-dialog-heading' },
          h('h2', null, 'Lodge 怎么用'),
          h('p', null, '这里是工作的地方，不是聊天工具。')),
        h('div', { className: 'crew-dialog-body' },
          h('dl', { className: 'crew-help-list' }, HELP_TOPICS.map(([title, text]) => h(Fragment, { key: title },
            h('dt', null, title),
            h('dd', null, text))))),
        h('div', { className: 'crew-dialog-foot' },
          h('button', { type: 'button', className: 'crew-ghost', autoFocus: true, onClick: close }, '知道了'))))
      : null)
}
