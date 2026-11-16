import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Composer } from '../composer.js'
import { BodySwapDialog } from '../room/body-swap-dialog.js'
import { MemberAddDialog } from '../room/member-add-dialog.js'
import { uiKindOfRoom } from '../room/kinds.js'
import { uiModeOfRoom } from './room-modes.js'

function RoomView({ state, room, store, onStartStudio, onStartChat }) {
  const [dockOpen, setDockOpen] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [swapId, setSwapId] = useState(null)
  const [swapBusy, setSwapBusy] = useState(false)
  const [swapError, setSwapError] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState(null)
  const scroll = useRef(null)
  const mainRef = useRef(null)
  const composerRef = useRef(null)
  const stick = useRef(true)
  const lastTop = useRef(0)
  const touchY = useRef(0)
  const mode = uiModeOfRoom(room)
  const kind = uiKindOfRoom(room)
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
    const top = mode.opensAtTop?.({ room }) === true
    stick.current = !top
    setAtBottom(true)
    if (top) {
      const node = scroll.current
      if (node) node.scrollTop = 0
      lastTop.current = 0
    } else {
      pinToBottom()
    }
  }, [room.id, room.state, mode])

  useEffect(() => {
    if (room.chatUnread === true) void store.markRead()
  }, [room.id, room.chatUnread, store])

  useLayoutEffect(() => {
    if (stick.current) pinToBottom()
  }, [lastId, room.id])

  // 流式文本、输入框增高、结果卡出现都会改变内容高度；回调在绘制前贴底。
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
  const members = useMemo(() => {
    if (Array.isArray(room.members) && room.members.length > 0) return room.members
    return state.roles ?? []
  }, [room.members, state.roles])
  const mentionMembers = useMemo(() => {
    const list = (room.members ?? []).map(member => ({
      id: member.id,
      name: member.name ?? member.id,
      mention: member.body?.name ?? member.name ?? member.id,
    }))
    return list.length > 1 ? [...list, { id: 'all', name: '所有人', mention: '所有人' }] : list
  }, [room.members])

  const actions = {
    store,
    accept: stage => void store.accept(stage),
    chatAccept: () => store.chatAccept(),
    approval: (id, decisionValue) => void store.decideApproval(id, decisionValue),
    answerCard: (memberId, requestId, message) => void store.answerCard(memberId, requestId, message),
    hold: (memberId, held) => void store.holdMember(memberId, held),
    cancelQueue: queueId => void store.cancelQueued(queueId),
    steerQueue: queueId => void store.steerQueued(queueId),
    continueChat: note => store.continueChat(note),
    createSubroom: goal => store.createSubroom(goal),
    shadowReview: enabled => store.shadowReviewRoom(room.id, enabled),
    selectRoom: id => store.select(id),
    startStudio: onStartStudio,
    startChat: onStartChat,
    swapBody: memberId => {
      setSwapError(null)
      setSwapId(memberId)
    },
    addMember: () => {
      setAddError(null)
      setAddOpen(true)
    },
  }
  // 阶段坞需要宿主动作；只有声明了 dock 的模式会渲染它。
  const dock = {
    open: dockOpen,
    onOpenChange: setDockOpen,
    onAccept: stage => void store.accept(stage),
    onAnswer: (stage, text) => void store.answer(stage, text),
    onSetAcceptance: (stage, command) => void store.setAcceptance(stage, command),
    onVerify: stage => void store.verify(stage),
    onRework: (stage, note) => void store.rework(stage, note),
    onApproval: (id, decision) => void store.decideApproval(id, decision),
    advisor: state.advisor ?? { available: false, host: '' },
    onShadowReconfirm: () => store.shadowReviewRoom(room.id, true),
  }
  const viewCtx = { state, room, members, locked, actions, dock, store }
  const typing = mode.typing?.(viewCtx) ?? null
  const composerPlaceholder = mode.composerPlaceholder?.(viewCtx) ?? '对房间说话…'

  return h('main', { className: 'dsb-main crew-room' },
    h('div', { ref: mainRef, className: 'crew-room-main', 'data-mode': mode.id },
      mode.header(viewCtx),
      mode.activity(viewCtx),
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
      mode.dock?.(viewCtx) ?? null,
      h('div', { ref: composerRef, className: 'dsb-composer' },
        h(Composer, {
          members: mentionMembers,
          onSent: followBottom,
          placeholder: room.state === 'complete'
            ? '这次工作已完成；说话可以开新一轮…'
            : room.state === 'paused'
              ? '已暂停 · 继续后才能派新活'
              : room.state === 'stopped'
                ? '已停止 · 不会再派新活'
                : composerPlaceholder,
          disabled: state.phase === 'loading' || locked,
          onSend: text => store.send(text),
        }))),
    swapId === null
      ? null
      : h(BodySwapDialog, {
        key: swapId,
        member: members.find(item => item.id === swapId) ?? { id: swapId, name: '成员', body: {} },
        canRemove: !['planner', 'lead'].includes(
          members.find(item => item.id === swapId)?.roleKind
            ?? members.find(item => item.id === swapId)?.role,
        ),
        engines: state.engines ?? [],
        requiresGate: kind.readOnly !== true && (members.find(item => item.id === swapId)?.permissions?.exec === true),
        busy: swapBusy,
        error: swapError,
        onRefresh: () => store.refresh(),
        onCancel: () => {
          if (swapBusy) return
          setSwapId(null)
          setSwapError(null)
        },
        onConfirm: async input => {
          setSwapBusy(true)
          setSwapError(null)
          const result = await store.swapBody(swapId, input.engine, input.model, input)
          setSwapBusy(false)
          if (result?.ok !== true) {
            setSwapError(result?.error ?? '身体没换成')
            return
          }
          setSwapId(null)
        },
        onRemove: async () => {
          setSwapBusy(true)
          setSwapError(null)
          const result = await store.removeMember(swapId)
          setSwapBusy(false)
          if (result?.ok !== true) {
            setSwapError(result?.error ?? '成员没移除')
            return
          }
          setSwapId(null)
        },
      }),
    addOpen
      ? h(MemberAddDialog, {
        engines: state.engines ?? [],
        busy: addBusy,
        error: addError,
        onRefresh: () => store.refresh(),
        onCancel: () => {
          if (addBusy) return
          setAddOpen(false)
          setAddError(null)
        },
        onConfirm: async input => {
          setAddBusy(true)
          setAddError(null)
          const result = await store.addMember(input.name, input.role, input.engine, input.model, input)
          setAddBusy(false)
          if (result?.ok !== true) {
            setAddError(result?.error ?? '成员没加进去')
            return
          }
          setAddOpen(false)
        },
      })
      : null)
}

export { RoomView }
