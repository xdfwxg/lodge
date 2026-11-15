import { Fragment, createElement as h, useState } from 'react'
import { ArrowRightIcon } from '../../icons.js'
import { Markdown, Speaker } from '../../message-cards.js'
import { timeOf } from '../../view-format.js'
import { StudioIcon } from '../type-icons.js'
import { chatStudioSeed } from './seed.js'

// 聊天室的轮次结论卡；只在聊天室时间线里出现。
export function ChatConclusionCard({ message, seat, room, onAccept, onContinueChat, onStartStudio }) {
  const meta = message.meta ?? {}
  const round = meta.round ?? 1
  const chat = room.chat ?? {}
  const currentRound = round === (chat.round ?? 1)
  const latest = room.state === 'active' &&
    chat.running !== true &&
    chat.phase === 'awaiting_decision' &&
    currentRound
  const accepted = room.state === 'complete' && currentRound
  // 模型有时自带「第 N 轮总结」标题；卡头已经有轮次，正文不重复。
  const summary = String(message.text ?? '').replace(/^#{0,3}\s*第\s*\d+\s*轮\s*(总结|结论)[:：]?\s*\n+/, '')
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const accept = async () => {
    if (busy) return
    setBusy(true)
    await onAccept()
    setBusy(false)
  }
  const continueChat = async () => {
    if (busy) return
    setBusy(true)
    await onContinueChat(note.trim())
    setBusy(false)
    setOpen(false)
    setNote('')
  }
  return h('div', { className: 'crew-msg-conclusion crew-msg-chat' },
    h(Speaker, { seat, ts: message.ts, time: false, station: false }),
    h('div', { className: 'crew-card crew-conclusion', 'data-settled': accepted ? 'true' : undefined },
        h('div', { className: 'crew-card-body' },
          h('b', { className: 'crew-conclusion-title' }, `第 ${round} 轮结论`),
          meta.fallback === true
            ? h('p', { className: 'crew-field-hint' }, '主持人未能在限定时间内总结；以下是原始讨论摘要。')
            : null,
          h(Markdown, { text: summary, variant: 'compact' })),
        latest
          ? h('div', { className: 'crew-card-foot' },
            open
              ? h(Fragment, null,
                h('div', { key: 'note', className: 'crew-rework' },
                  h('input', {
                    className: 'crew-goal-input',
                    type: 'text',
                    'aria-label': '补充讨论说明（可选）',
                    value: note,
                    placeholder: '还需要讨论什么？',
                    onChange: event => setNote(event.target.value),
                    onKeyDown: event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void continueChat()
                      }
                    },
                  })),
                h('button', {
                  key: 'cancel',
                  type: 'button',
                  className: 'crew-ghost',
                  disabled: busy,
                  onClick: () => { setOpen(false); setNote('') },
                }, '取消'),
                h('button', {
                  key: 'send',
                  type: 'button',
                  className: 'crew-accept',
                  disabled: busy || room.state !== 'active',
                  onClick: () => void continueChat(),
                }, busy ? '正在发送…' : '发送'))
              : h(Fragment, null,
                h('button', {
                  key: 'discuss',
                  type: 'button',
                  className: 'crew-ghost',
                  disabled: busy || room.state !== 'active',
                  onClick: () => setOpen(true),
                }, '继续讨论'),
                h('button', {
                  key: 'accept',
                  type: 'button',
                  className: 'crew-accept crew-conclusion-pending',
                  disabled: busy || room.state !== 'active',
                  onClick: () => void accept(),
                }, busy ? '处理中…' : '待你确认')))
          : null,
        accepted && typeof onStartStudio === 'function'
          ? h('div', { className: 'crew-card-foot', 'data-settled': true },
            h('span', { className: 'crew-conclusion-signoff' }, `${seat?.name ?? 'Lodge 主持'} · ${timeOf(message.ts)}`),
            h('button', {
              type: 'button',
              className: 'crew-accept crew-conclusion-next',
              'aria-label': '按结论新建工作室',
              onClick: () => onStartStudio(chatStudioSeed({ room, conclusion: message.text })),
            },
            h(StudioIcon, { size: 16 }),
            '开工作室',
            h(ArrowRightIcon)))
          : null))
}
