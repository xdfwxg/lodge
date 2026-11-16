import { Fragment, createElement as h, useEffect, useState } from 'react'
import { Island } from '../../island.js'
import { TargetIcon } from '../../icons.js'
import { chatConclusionOf } from './decision.js'
import { chatStudioSeed } from './seed.js'

const STATUS = {
  'chat-running': { label: '正在聊', tone: 'active' },
  'chat-decision': { label: '待确认', tone: 'waiting' },
  'chat-complete': { label: '结论已确认', tone: 'done' },
  'chat-interrupted': { label: '断了', tone: 'paused' },
}

export const chatIslandState = decision => (
  STATUS[decision?.key] ?? {
    label: decision?.title ?? '聊天室',
    tone: decision?.tone ?? 'active',
  }
)

// The island only grows at the two moments that change what happens next:
// a conclusion waiting for confirmation, and a confirmed conclusion ready to
// become work. Every other state stays a quiet pill.
export const chatIslandView = ({ decision } = {}) => ({
  ...chatIslandState(decision),
  detail: decision?.detail,
  primary: decision?.primary ?? undefined,
  secondary: decision?.secondary ?? undefined,
})

export function ChatIsland({ room, decision, actions = {} }) {
  const view = chatIslandView({ decision })
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setNoteOpen(false)
    setNote('')
  }, [decision?.key, room.id])

  const accept = async () => {
    if (busy || typeof actions.chatAccept !== 'function') return
    setBusy(true)
    try {
      await actions.chatAccept()
    } finally {
      setBusy(false)
    }
  }
  const continueChat = async () => {
    if (busy || typeof actions.continueChat !== 'function') return
    setBusy(true)
    try {
      await actions.continueChat(note.trim())
      setNoteOpen(false)
      setNote('')
    } finally {
      setBusy(false)
    }
  }
  const startStudio = () => {
    const conclusion = chatConclusionOf(room)
    if (conclusion === null || typeof actions.startStudio !== 'function') return
    actions.startStudio(chatStudioSeed({
      room,
      conclusion: conclusion.text,
      handoff: conclusion.meta?.handoff,
    }))
  }
  const run = action => {
    if (action === 'chat-accept') void accept()
    else if (action === 'continue-chat') setNoteOpen(value => !value)
    else if (action === 'start-studio') startStudio()
  }

  const noteBox = noteOpen
    ? h('div', { className: 'crew-island-note' },
      h('input', {
        className: 'crew-goal-input',
        type: 'text',
        autoFocus: true,
        value: note,
        placeholder: '还想讨论什么？',
        'aria-label': '还想讨论什么（可选）',
        disabled: busy,
        onChange: event => setNote(event.target.value),
        onKeyDown: event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            continueChat()
          }
          if (event.key === 'Escape') {
            setNoteOpen(false)
            setNote('')
          }
        },
      }),
      h('button', {
        type: 'button',
        className: 'crew-ghost',
        disabled: busy,
        onClick: () => {
          setNoteOpen(false)
          setNote('')
        },
      }, '取消'),
      h('button', {
        type: 'button',
        className: 'crew-accept',
        disabled: busy,
        onClick: () => void continueChat(),
      }, busy ? '发送中…' : '发送'))
    : null

  const detail = view.detail === undefined && noteBox === null
    ? null
    : h(Fragment, null,
      view.detail === undefined
        ? null
        : h('p', { className: 'crew-island-detail-text', title: view.detail }, view.detail),
      noteBox)

  const footer = view.primary === undefined
    ? null
    : h('div', { className: 'crew-island-actions' },
      h('button', {
        type: 'button',
        className: 'crew-accept',
        disabled: busy,
        onClick: () => run(view.primary.action),
      }, view.primary.label),
      view.secondary === undefined
        ? null
        : h('button', {
          type: 'button',
          className: 'crew-island-secondary',
          disabled: busy,
          onClick: () => run(view.secondary.action),
        }, noteOpen ? '收起' : view.secondary.label))

  return h(Island, {
    title: room.name || room.goal || '聊天室',
    status: view.label,
    tone: view.tone,
    icon: h(TargetIcon),
    titleText: room.goal,
    detail,
    footer,
  })
}
