import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { GoalIsland } from '../goal-island/index.js'
import { buildGoalView } from '../goal-island/model.js'
import { DeliverySheet } from '../delivery-sheet.js'
import { Composer } from '../composer.js'
import { ReviewDialog } from '../room/advanced.js'
import { RoomRail } from '../room/rail.js'
import { StageDock } from '../room/stage-dock.js'
import { Timeline } from '../room/timeline.js'
import { ReplayDialog } from '../room/replay.js'
import { ShadowDialog } from '../room/shadow.js'

function RoomView({ state, room, store, onContinue, onStartStudio }) {
  const [railTab, setRailTab] = useState('status')
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
  const isChat = room.roomType === 'chat'
  const chat = room.chat ?? {}
  const seats = useMemo(() => {
    if (Array.isArray(room.seatSpecs) && room.seatSpecs.length > 0) return room.seatSpecs
    const ids = room.members ?? []
    return ids.length === 0 ? state.seats : state.seats.filter(seat => ids.includes(seat.id))
  }, [room.seatSpecs, room.members, state.seats])
  const goalView = useMemo(() => (isChat ? null : buildGoalView(room, seats)), [isChat, room, seats])
  const primary = room.state === 'active' && room.needsYou
    ? {
      label: isChat && room.needsYou.kind === 'decision'
        ? '确认结论'
        : room.needsYou.kind === 'rework'
          ? '处理退回'
          : room.needsYou.kind === 'review'
            ? '去验收'
            : room.needsYou.kind === 'signoff'
              ? '去签字'
              : '处理',
      onClick: isChat ? scrollToBottom : () => setDockOpen(true),
    }
    : undefined
  const mentionMembers = useMemo(() => {
    const members = (room.members ?? []).map(id => ({
      id,
      name: seats.find(seat => seat.id === id)?.name ?? id,
      mention: room.seatNames?.[id] ?? id,
    }))
    return members.length > 1 ? [...members, { id: 'all', name: '所有人', mention: '所有人' }] : members
  }, [room.members, room.seatNames, seats])
  const goalActions = {
    review: () => void store.openReview(room.id),
    toggleAdvanced: () => setRailTab(value => value === 'advanced' ? 'status' : 'advanced'),
    pause: () => void store.pause(),
    resume: () => void store.resume(),
    stop: () => void store.stop(),
    ...(primary === undefined ? {} : { primary }),
    ...(onContinue === undefined ? {} : { continue: () => onContinue(room) }),
  }

  return h('main', { className: 'dsb-main crew-room' },
    h('div', { className: 'crew-room-main' },
      isChat || goalView === null ? null : h(GoalIsland, { view: goalView, advanced: railTab === 'advanced', actions: goalActions }),
    state.reviewFor === room.id && state.review !== null
      ? h(ReviewDialog, { review: state.review, onClose: () => store.closeReview() })
      : null,
    state.replayFor === room.id && state.replay !== null
      ? h(ReplayDialog, { replay: state.replay, onClose: () => store.closeReplay() })
      : null,
    state.shadowFor === room.id && state.shadow !== null
      ? h(ShadowDialog, { review: state.shadow, onClose: () => store.closeShadow() })
      : null,
    h('div', { ref: scroll, className: 'dsb-scroll crew-scroll', onScroll: trackScroll },
      room.delivery ? h(DeliverySheet, { delivery: room.delivery, onExport: () => void store.exportDelivery() }) : null,
      isChat
        ? h('div', { className: 'crew-chat-status' },
          chat.phase === 'summarizing'
            ? `第 ${chat.round ?? 1} 轮 · 主持人总结中`
            : chat.running
              ? `第 ${chat.round ?? 1} 轮 · 讨论中 ${chat.turns ?? 0}/${chat.turnLimit ?? 6}`
              : room.state === 'complete'
                ? '聊天已结束'
                : room.state === 'stopped'
                  ? '聊天已停止'
                  : room.state === 'paused'
                    ? '聊天已暂停'
                    : `第 ${chat.round ?? 1} 轮 · 等你确认结论`)
        : null,
      h('div', { className: 'crew-flow' }, h(Timeline, {
        room,
        seats,
        onAccept: stage => void (isChat ? store.chatAccept() : store.accept(stage)),
        onApproval: (id, decision) => void store.decideApproval(id, decision),
        onContinueChat: note => void store.continueChat(note),
        onStartStudio,
      })),
      state.error ? h('div', { className: 'crew-error' }, state.error) : null),
    isChat
      ? null
      : h(StageDock, {
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
    !atBottom
      ? h('button', { type: 'button', className: 'crew-jump-latest', onClick: scrollToBottom }, '回到最新')
      : null,
    isChat && chat.running && typeof chat.speaker === 'string' && chat.speaker !== ''
      ? h('div', { className: 'crew-typing' },
        chat.phase === 'summarizing'
          ? '主持人正在总结…'
          : `${seats.find(seat => seat.id === chat.speaker)?.name ?? '成员'} 正在组织发言…`)
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
    h(RoomRail, {
      room,
      seats,
      store,
      engines: state.engines,
      rooms: state.rooms,
      tab: railTab,
      onTab: setRailTab,
      ledger: state.ledgerFor === room.id ? state.ledger : null,
    }))
}

export { RoomView }
