import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { DeliverySheet } from '../delivery-sheet.js'
import { Composer } from '../composer.js'
import { ReviewDialog } from '../room/studio/advanced.js'
import { AuditDrawer } from '../room/audit.js'
import { RoomRail } from '../room/rail.js'
import { StageDock } from '../room/stage-dock.js'
import { ReplayDialog } from '../room/replay.js'
import { ShadowDialog } from '../room/shadow.js'
import { uiModeOfRoom } from './room-modes.js'

function RoomView({ state, room, store, onContinue, onStartStudio }) {
  const [railTab, setRailTab] = useState('status')
  const [auditOpen, setAuditOpen] = useState(false)
  const [dockOpen, setDockOpen] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const scroll = useRef(null)
  const stick = useRef(true)
  const seenComplete = useRef(false)
  const lastId = room.messages.at(-1)?.id
  const hasDelivery = room.delivery !== null && room.delivery !== undefined

  const scrollToBottom = () => {
    const node = scroll.current
    if (!node) return
    stick.current = true
    setAtBottom(true)
    node.scrollTop = node.scrollHeight
  }

  useEffect(() => {
    seenComplete.current = false
    stick.current = true
    setAtBottom(true)
    setAuditOpen(false)
  }, [room.id])

  useEffect(() => {
    if (room.chatUnread === true) void store.markRead()
  }, [room.id, room.chatUnread, store])

  useEffect(() => {
    const node = scroll.current
    if (!node) return
    if (hasDelivery && !seenComplete.current) {
      seenComplete.current = true
      node.scrollTop = 0
      return
    }
    seenComplete.current = hasDelivery
    if (stick.current) node.scrollTop = node.scrollHeight
  }, [lastId, room.id, hasDelivery])

  const trackScroll = event => {
    const node = event.currentTarget
    const near = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    stick.current = near
    setAtBottom(near)
  }

  const locked = room.state === 'paused' || room.state === 'stopped'
  const mode = uiModeOfRoom(room)
  const isChat = mode.id === 'chat'
  const chat = room.chat ?? {}
  const seats = useMemo(() => {
    if (Array.isArray(room.seatSpecs) && room.seatSpecs.length > 0) return room.seatSpecs
    const ids = room.members ?? []
    return ids.length === 0 ? state.seats : state.seats.filter(seat => ids.includes(seat.id))
  }, [room.seatSpecs, room.members, state.seats])
  const viewModel = useMemo(() => mode.buildViewModel({ room, seats }), [mode, room, seats])
  const decision = useMemo(() => mode.buildDecision({ room, viewModel }), [mode, room, viewModel])
  const typingSeatId = room.chatBusySeat
    || (isChat ? chat.speaker : '')
    || (room.busySeats?.length === 1 ? room.busySeats[0] : '')
  const typingSeat = seats.find(seat => seat.id === typingSeatId) ?? null
  const typing = isChat && !locked && typingSeatId !== ''
    && (room.chatWorking === true || chat.running === true || room.busy === true)
  useEffect(() => {
    if (typing && stick.current) scrollToBottom()
  }, [typingSeatId, typing])
  const mentionMembers = useMemo(() => {
    const members = (room.members ?? []).map(id => ({
      id,
      name: seats.find(seat => seat.id === id)?.name ?? id,
      mention: room.seatNames?.[id] ?? id,
    }))
    return members.length > 1 ? [...members, { id: 'all', name: '所有人', mention: '所有人' }] : members
  }, [room.members, room.seatNames, seats])

  const decisionAction = (action, payload, note) => {
    if (action === 'sign') return void store.accept(payload)
    if (action === 'rework' || action === 'rework-submit') return void store.rework(payload, note ?? '')
    if (action === 'resume') return void store.resume()
    if (action === 'verify') return void store.verify(payload)
    if (action === 'chat-accept') return void store.chatAccept()
    if (action === 'continue-chat') return void store.continueChat('')
    if (action === 'chat-resume') return void store.resumeChat()
    if (action === 'start-studio') {
      if (onStartStudio !== undefined) onStartStudio(payload)
      return
    }
    if (action === 'evidence') {
      setAuditOpen(true)
      setRailTab('evidence')
      void store.openLedger(room.id)
      return
    }
    if (action === 'delivery') {
      scroll.current?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (action === 'export') return void store.exportDelivery()
    setAuditOpen(true)
  }

  const actions = {
    store,
    audit: () => setAuditOpen(true),
    review: () => void store.openReview(room.id),
    continueRoom: onContinue === undefined ? undefined : () => onContinue(room),
    decision: decisionAction,
    accept: stage => void store.accept(stage),
    chatAccept: () => void store.chatAccept(),
    approval: (id, decisionValue) => void store.decideApproval(id, decisionValue),
    continueChat: note => void store.continueChat(note),
    startStudio: onStartStudio,
  }
  const viewCtx = { room, seats, chat, decision, viewModel, actions, store }

  return h('main', { className: 'dsb-main crew-room' },
    h('div', { className: 'crew-room-main' },
      mode.header(viewCtx),
      mode.activity(viewCtx),
      mode.decisionCard(viewCtx),
      state.reviewFor === room.id && state.review !== null
        ? h(ReviewDialog, { review: state.review, onClose: () => store.closeReview() })
        : null,
      state.replayFor === room.id && state.replay !== null
        ? h(ReplayDialog, { replay: state.replay, onClose: () => store.closeReplay() })
        : null,
      state.shadowFor === room.id && state.shadow !== null
        ? h(ShadowDialog, { review: state.shadow, focus: state.shadowFocus, onClose: () => store.closeShadow() })
        : null,
      h('div', { ref: scroll, className: 'dsb-scroll crew-scroll', onScroll: trackScroll },
        room.delivery ? h(DeliverySheet, { delivery: room.delivery, onExport: () => void store.exportDelivery() }) : null,
        h('div', { className: 'crew-flow' },
          mode.transcript(viewCtx),
          mode.presence(viewCtx),
        typing
          ? mode.typing({ ...viewCtx, seat: typingSeat, summarizing: isChat && chat.phase === 'summarizing' })
          : null),
        state.error ? h('div', { className: 'crew-error', role: 'alert' }, state.error) : null),
      !atBottom
        ? h('button', { type: 'button', className: 'crew-jump-latest', onClick: scrollToBottom }, '回到最新')
        : null,
      h('div', { className: 'dsb-composer' },
        h(Composer, {
          members: mentionMembers,
          onSent: scrollToBottom,
          placeholder: room.state === 'complete'
            ? '这次交付已结束；说话可以开新一轮…'
            : room.state === 'paused'
              ? '已暂停 · 继续后才能派新活'
              : room.state === 'stopped'
                ? '已停止 · 不会再派新活'
                : '对房间说话…',
          disabled: state.phase === 'loading' || locked,
          onSend: text => store.send(text),
        }))),
    h(AuditDrawer, { open: auditOpen, onClose: () => setAuditOpen(false) },
      h(StageDock, {
        room,
        open: dockOpen,
        onOpenChange: setDockOpen,
        onAccept: stage => void store.accept(stage),
        onAnswer: (stage, text) => void store.answer(stage, text),
        onSimulate: () => void store.simulate(),
        onSetAcceptance: (stage, command) => void store.setAcceptance(stage, command),
        onVerify: stage => void store.verify(stage),
        onRework: (stage, note) => void store.rework(stage, note),
      }),
      h(RoomRail, {
        room,
        seats,
        store,
        engines: state.engines,
        rooms: state.rooms,
        tab: railTab,
        onTab: setRailTab,
        ledger: state.ledgerFor === room.id ? state.ledger : null,
        integrity: state.integrityFor === room.id ? state.integrity : null,
      })))
}

export { RoomView }
