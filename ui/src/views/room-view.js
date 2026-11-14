import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Composer } from '../composer.js'
import { AuditDrawer } from '../room/audit.js'
import { RoomRail } from '../room/rail.js'
import { uiModeOfRoom } from './room-modes.js'

function RoomView({ state, room, store, onContinue, onStartStudio }) {
  const [railTab, setRailTab] = useState('status')
  const [auditOpen, setAuditOpen] = useState(false)
  const [dockOpen, setDockOpen] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const scroll = useRef(null)
  const mainRef = useRef(null)
  const composerRef = useRef(null)
  const stick = useRef(true)
  const lastTop = useRef(0)
  const touchY = useRef(0)
  const mode = uiModeOfRoom(room)
  const lastId = room.messages.at(-1)?.id

  // 贴底必须发生在绘制前：rAF 会先画一帧旧位置，再跳到底，连续输出时就是跳屏。
  const pinToBottom = () => {
    const node = scroll.current
    if (!node) return
    node.scrollTop = node.scrollHeight
    lastTop.current = node.scrollTop
  }

  const followBottom = () => {
    stick.current = true
    setAtBottom(true)
    pinToBottom()
  }

  const breakFollow = () => {
    if (!stick.current) return
    stick.current = false
    setAtBottom(false)
  }
  const atEnd = node => node.scrollHeight - node.scrollTop - node.clientHeight <= 4

  useLayoutEffect(() => {
    stick.current = true
    setAtBottom(true)
    setAuditOpen(false)
    pinToBottom()
  }, [room.id])

  useEffect(() => {
    if (room.chatUnread === true) void store.markRead()
  }, [room.id, room.chatUnread, store])

  useLayoutEffect(() => {
    if (stick.current) pinToBottom()
  }, [lastId, room.id])

  // 流式文本、输入框增高、交付单出现都会改变内容高度；回调在绘制前贴底。
  useEffect(() => {
    const node = scroll.current
    if (node === null || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => {
      if (stick.current) pinToBottom()
    })
    observer.observe(node)
    for (const child of node.children) observer.observe(child)
    return () => observer.disconnect()
  }, [room.id])

  // 输入条高度会变；「回到最新」始终浮在它上方，而不是写死 124px。
  useEffect(() => {
    const composer = composerRef.current
    const root = mainRef.current
    if (composer === null || root === null || typeof ResizeObserver !== 'function') return undefined
    const sync = () => root.style.setProperty('--crew-composer-h', `${composer.offsetHeight}px`)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(composer)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--crew-composer-h')
    }
  }, [room.id])

  // 只有用户的向上手势才脱离跟随；内容增长/收缩带来的 scroll 事件不能改变跟随态。
  const trackScroll = event => {
    const node = event.currentTarget
    const previousTop = lastTop.current
    lastTop.current = node.scrollTop
    if (stick.current) return
    if (node.scrollTop > previousTop && atEnd(node)) followBottom()
  }

  const onWheel = event => {
    if (event.deltaY < 0) breakFollow()
    else if (atEnd(event.currentTarget)) followBottom()
  }

  const onTouchStart = event => {
    touchY.current = event.touches[0]?.clientY ?? 0
  }

  const onTouchMove = event => {
    const y = event.touches[0]?.clientY ?? 0
    if (y > touchY.current + 4) breakFollow()
    else if (atEnd(event.currentTarget)) followBottom()
  }

  // 拖动滚动条本身不产生 wheel 事件；滚动条的轨道在 clientWidth 之外。
  const onPointerDown = event => {
    const node = event.currentTarget
    if (event.target === node && event.nativeEvent.offsetX >= node.clientWidth) breakFollow()
  }

  useEffect(() => {
    const onKey = event => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (target instanceof Element && target.closest('select, [contenteditable="true"]') !== null) return
      if (event.key === 'PageUp' || event.key === 'Home' || event.key === 'ArrowUp') breakFollow()
      if (event.key === 'End') followBottom()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const locked = room.state === 'paused' || room.state === 'stopped'
  const seats = useMemo(() => {
    if (Array.isArray(room.seatSpecs) && room.seatSpecs.length > 0) return room.seatSpecs
    const ids = room.members ?? []
    return ids.length === 0 ? state.seats : state.seats.filter(seat => ids.includes(seat.id))
  }, [room.seatSpecs, room.members, state.seats])
  const viewModel = useMemo(() => mode.buildViewModel({ room, seats }), [mode, room, seats])
  const decision = useMemo(() => mode.buildDecision({ room, viewModel }), [mode, room, viewModel])
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
  // 阶段坞需要宿主动作；只有声明了 dock 的模式会渲染它。
  const dock = {
    open: dockOpen,
    onOpenChange: setDockOpen,
    onAccept: stage => void store.accept(stage),
    onAnswer: (stage, text) => void store.answer(stage, text),
    onSimulate: () => void store.simulate(),
    onSetAcceptance: (stage, command) => void store.setAcceptance(stage, command),
    onVerify: stage => void store.verify(stage),
    onRework: (stage, note) => void store.rework(stage, note),
  }
  const viewCtx = { state, room, seats, locked, decision, viewModel, actions, dock, store }
  const typing = mode.typing?.(viewCtx) ?? null

  return h('main', { className: 'dsb-main crew-room' },
    h('div', { ref: mainRef, className: 'crew-room-main' },
      mode.header(viewCtx),
      mode.activity(viewCtx),
      mode.decisionCard(viewCtx),
      mode.overlay?.(viewCtx) ?? null,
      h('div', {
        ref: scroll,
        className: 'dsb-scroll crew-scroll',
        onScroll: trackScroll,
        onWheel,
        onTouchStart,
        onTouchMove,
        onPointerDown,
      },
        h('div', { className: 'crew-flow' },
          mode.transcript(viewCtx),
          mode.presence(viewCtx),
          typing),
        state.error ? h('div', { className: 'crew-error', role: 'alert' }, state.error) : null),
      !atBottom
        ? h('button', { type: 'button', className: 'crew-jump-latest', onClick: followBottom }, '回到最新')
        : null,
      h('div', { ref: composerRef, className: 'dsb-composer' },
        h(Composer, {
          members: mentionMembers,
          onSent: followBottom,
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
      mode.dock?.(viewCtx) ?? null,
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
