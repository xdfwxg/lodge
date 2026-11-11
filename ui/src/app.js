import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { BotAvatar, BotMark, RoomAvatar } from './dsbot/client/mark.js'
import { ArrowUpIcon } from './dsbot/client/icons.js'
import { MarkdownText } from './primitives.js'
import { createStore, useStore } from './store.js'

const WHALE = { shape: 'whale', color: 'deepseek' }
const TABS = [['all', '全部'], ['bots', '机器人'], ['groups', '群组']]
const MD = { code: { copyLabel: '复制', copiedLabel: '已复制' } }
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

const timeOf = ts => {
  try {
    return clock.format(new Date(ts))
  } catch {
    return ''
  }
}

const stageLabel = (stage, index) => `${index + 1} ${stage.title}`
const stageKind = stage => (stage.kind === 'decision' ? '人确认' : stage.acceptance)

function Markdown({ text, variant }) {
  return h(MarkdownText, { text, labels: MD, variant })
}

function Speaker({ seat, ts }) {
  return h('div', { className: 'crew-speaker' },
    h('span', { className: 'crew-speaker-name' }, seat?.name ?? '—'),
    h('span', { className: 'crew-speaker-station' }, seat?.title ?? ''),
    h('span', { className: 'crew-speaker-time' }, timeOf(ts)))
}

function ChatLine({ message, seat }) {
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotAvatar, { bot: seat, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts }),
      h('div', { className: 'bt-bubble' }, h(Markdown, { text: message.text }))))
}

function EvidenceCard({ message, seat }) {
  const meta = message.meta ?? {}
  const ok = meta.exit === 0
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotAvatar, { bot: seat, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts }),
      h('div', { className: 'crew-card' },
        h('div', { className: 'crew-card-head' },
          `证据 · 阶段 ${(meta.stage ?? 0) + 1}`,
          h('span', { className: 'crew-verdict', 'data-pass': ok, 'data-reject': !ok }, `exit ${meta.exit}`)),
        h('div', { className: 'crew-card-body' },
          h('div', { className: 'crew-kv' }, h('span', null, '命令'), h('code', null, meta.command)),
          meta.files?.length ? h('div', { className: 'crew-kv' }, h('span', null, '改动'), h('span', null, meta.files.join(' · '))) : null,
          meta.output ? h('pre', { className: 'crew-code' }, meta.output) : null,
          meta.diff ? h('pre', { className: 'crew-code' }, meta.diff) : null),
        h('div', { className: 'crew-card-foot' }, 'Executor 跑出 · 原始记录已写入 evidence/'))))
}

function VerdictCard({ message, seat, stage, onAccept }) {
  const meta = message.meta ?? {}
  const pass = meta.pass === true
  const active = stage?.state === 'active'
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotAvatar, { bot: seat, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts }),
      h('div', { className: 'crew-card' },
        h('div', { className: 'crew-card-head' },
          `验收 · 阶段 ${(meta.stage ?? 0) + 1}`,
          h('span', { className: 'crew-verdict', 'data-pass': pass, 'data-reject': !pass }, pass ? 'PASS' : 'REJECT')),
        h('div', { className: 'crew-card-body' },
          meta.command ? h('div', { className: 'crew-kv' }, h('span', null, '命令'), h('code', null, meta.command)) : null,
          meta.exit !== undefined ? h('div', { className: 'crew-kv' }, h('span', null, '退出码'), h('code', null, String(meta.exit))) : null,
          message.text ? h(Markdown, { text: message.text, variant: 'compact' }) : null),
        h('div', { className: 'crew-card-foot' },
          'Verifier 只读复核 · 与 Executor 不同厂商',
          pass && active
            ? h('button', { type: 'button', className: 'crew-accept', onClick: () => onAccept(meta.stage) }, '接受这一阶段')
            : null,
          !active && stage?.state === 'passed' ? h('span', { className: 'crew-accepted' }, '已由你验收') : null))))
}

function Sidebar({ state, tab, setTab }) {
  const { room, seats } = state
  const roster = useMemo(() => ({
    byId: Object.fromEntries(seats.map(seat => [seat.id, seat])),
    roomsById: room ? { [room.id]: room } : {},
    exchangeTurns: {},
    questions: {},
  }), [seats, room])
  const activeStage = room?.stages.findIndex(stage => stage.state === 'active') ?? -1
  const roomPreview = room
    ? (activeStage >= 0 ? `阶段 ${activeStage + 1}/${room.stages.length} · 进行中` : `阶段 ${room.stages.length}/${room.stages.length} · 待总结`)
    : ''

  return h('aside', { className: 'dsb-side' },
    h('div', { className: 'crew-side-brand' }, h(BotMark, { look: WHALE, size: 22, live: false }), 'Crew Chat', h('small', null, '群 · room')),
    h('div', { className: 'crew-tabs', role: 'tablist' },
      TABS.map(([id, label]) => h('button', {
        key: id,
        type: 'button',
        role: 'tab',
        className: 'crew-tab',
        'aria-selected': tab === id,
        onClick: () => setTab(id),
      }, label))),
    h('div', { className: 'bt-side' },
      h('div', { className: 'bt-list' },
        room && tab !== 'bots'
          ? h('button', { type: 'button', className: 'bt-row', 'aria-current': 'page' },
            h(RoomAvatar, { room: { ...room, members: room.members ?? [] }, roster, size: 36 }),
            h('span', { className: 'bt-row-body' },
              h('span', { className: 'bt-row-name' },
                h('span', { className: 'bt-row-title' }, room.name),
                h('span', { className: 'bt-tag' }, '群')),
              h('span', { className: 'bt-row-preview' }, roomPreview)))
          : null,
        tab !== 'groups' ? h('div', { className: 'crew-section' }, '席位') : null,
        tab !== 'groups'
          ? seats.map(seat => h('button', { key: seat.id, type: 'button', className: 'bt-row' },
            h(BotAvatar, { bot: seat, size: 36, live: false }),
            h('span', { className: 'bt-row-body' },
              h('span', { className: 'bt-row-name' },
                h('span', { className: 'bt-row-title' }, seat.name),
                h('span', { className: 'bt-tag' }, seat.title)),
              h('span', { className: 'bt-row-preview' }, seat.station))))
          : null)),
    h('div', { className: 'crew-me' },
      h('span', { className: 'crew-me-badge' }, '你'),
      h('span', { className: 'crew-me-body' },
        h('b', null, '你 · 人'),
        h('small', null, '改 done / 加约束 / 最终否决'))))
}

function Header({ room }) {
  const independent = room.independence === 'vendor'
  return h('header', { className: 'crew-head' },
    h('div', { className: 'crew-title' },
      h('h1', null, room.name),
      h('span', { className: 'crew-badge', 'data-warn': !independent },
        independent ? '跨厂商复核' : '独立性降级 · 单 CLI'),
      h('span', { className: 'crew-badge' }, '你签字才算完成')),
    h('p', { className: 'crew-goal' }, '目标：', room.goal),
    h('div', { className: 'crew-stages' },
      room.stages.map((stage, index) => h('span', { key: stage.title, className: 'crew-stage', 'data-state': stage.state },
        h('b', null, stageLabel(stage, index)),
        h('small', null, stageKind(stage))))))
}

function Timeline({ state, store }) {
  const { room, seats, messages } = state
  const byId = useMemo(() => Object.fromEntries(seats.map(seat => [seat.id, seat])), [seats])

  return messages.map(message => {
    const seat = byId[message.authorId]
    if (message.kind === 'system') return h('div', { key: message.id, className: 'crew-system' }, message.text)
    if (message.kind === 'evidence') return h(EvidenceCard, { key: message.id, message, seat })
    if (message.kind === 'verdict') {
      return h(VerdictCard, {
        key: message.id,
        message,
        seat,
        stage: room.stages[message.meta?.stage ?? 0],
        onAccept: stage => void store.accept(stage),
      })
    }
    if (message.authorId === 'you') {
      return h('div', { key: message.id, className: 'crew-human' },
        h('div', { className: 'bt-ububble' }, h(Markdown, { text: message.text, variant: 'compact' })))
    }
    return h(ChatLine, { key: message.id, message, seat })
  })
}

function Composer({ store, disabled }) {
  const [draft, setDraft] = useState('')

  const send = () => {
    const text = draft.trim()
    if (text === '' || disabled) return
    setDraft('')
    void store.send(text)
  }

  return h('div', { className: 'dsb-composer' },
    h('div', { className: 'crew-composer' },
      h('textarea', {
        className: 'crew-input',
        rows: 1,
        value: draft,
        placeholder: '对房间说话，或 @Planner 重排计划…',
        disabled,
        onChange: event => setDraft(event.target.value),
        onKeyDown: event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            send()
          }
        },
      }),
      h('button', { type: 'button', className: 'crew-send', 'aria-label': '发送', disabled: disabled || draft.trim() === '', onClick: send },
        h(ArrowUpIcon))),
    h('div', { className: 'crew-composer-note' }, 'Enter 发送 · Shift+Enter 换行 · 席位之间用 @ 交接'))
}

export function App() {
  const store = useMemo(createStore, [])
  const state = useStore(store)
  const [tab, setTab] = useState('all')
  const scroll = useRef(null)

  useEffect(() => {
    store.start()
    return () => store.stop()
  }, [store])

  const lastId = state.messages.at(-1)?.id
  useEffect(() => {
    const node = scroll.current
    if (node) node.scrollTop = node.scrollHeight
  }, [lastId])

  if (state.room === null) {
    return h('div', { className: 'dsb-frame' },
      h('div', { className: 'dsb-side' },
        h('div', { className: 'crew-side-brand' }, h(BotMark, { look: WHALE, size: 22, live: false }), 'Crew Chat')),
      h('main', { className: 'dsb-main' },
        h('div', { className: 'crew-status' },
          state.phase === 'error' ? `连接失败：${state.error}` : '正在打开房间…')))
  }

  return h('div', { className: 'dsb-frame' },
    h(Sidebar, { state, tab, setTab }),
    h('main', { className: 'dsb-main' },
      h(Header, { room: state.room }),
      h('div', { ref: scroll, className: 'dsb-scroll crew-scroll' },
        h('div', { className: 'crew-flow' }, h(Timeline, { state, store })),
        state.error ? h('div', { className: 'crew-error' }, state.error) : null),
      h(Composer, { store, disabled: state.phase === 'loading' })))
}
