import { createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Composer } from '../composer.js'
import { BodySwapDialog } from '../room/body-swap-dialog.js'
import { StatePanel } from '../state-panel.js'
import { StopReply, turnRunning } from '../room/stop-reply.js'
import { uiKindOfRoom } from '../room/kinds.js'
import { roleLabelOf } from '../room/member-options.js'
import { uiModeOfRoom } from './room-modes.js'
import { ArrowDownIcon } from '../icons.js'
import { humanErrorText } from '../error-text.js'
import { MENTION_ALL } from '../../../shared/mentions.js'
import { stagesCompletedOf } from '../../../shared/room-status.js'

function RoomView({ state, room, store, onStartStudio, onStartChat }) {
  const [dropped, setDropped] = useState(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  const composerInput = useRef(null)
  const [swapId, setSwapId] = useState(null)
  const [swapBusy, setSwapBusy] = useState(false)
  const [swapError, setSwapError] = useState(null)
  const [chatReview, setChatReview] = useState(null)
  const reviewInFlight = useRef(false)
  const scroll = useRef(null)
  const holdPin = useRef(false)
  const holdTimer = useRef(null)
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
    setAtBottom(!top)
    if (top) {
      const node = scroll.current
      if (node) {
        node.scrollTop = 0
        lastTop.current = 0
        if (atEnd(node)) setAtBottom(true)
      }
    } else {
      pinToBottom()
    }
  }, [room.id, room.state, mode])

  useEffect(() => {
    if (room.chatUnread === true) void store.markRead()
  }, [room.id, room.chatUnread, store])

  useLayoutEffect(() => {
    if (stick.current && !holdPin.current) pinToBottom()
  }, [lastId, room.id])

  // 流式文本、输入框增高、结果卡出现都会改变内容高度；回调在绘制前贴底。
  // 展开详情是用户在当前阅读位置的主动动作，不能把页面重新贴到底。
  useEffect(() => {
    const node = scroll.current
    if (node === null || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => {
      if (stick.current && !holdPin.current) pinToBottom()
    })
    observer.observe(node)
    for (const child of node.children) observer.observe(child)
    return () => observer.disconnect()
  }, [room.id])

  useEffect(() => () => clearTimeout(holdTimer.current), [])

  // 展开/收起、定时开关都是用户在当前阅读位置的主动动作，不是新消息：
  // 贴底逻辑在这段时间里让路，焦点和位置都留在原处。
  const holdOnExpand = event => {
    const target = event.target?.closest?.('summary, [aria-expanded], [data-hold-pin]')
    if (target === null || target === undefined) return
    holdPin.current = true
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => { holdPin.current = false }, 600)
  }

  // 输入条高度会变；「回到最新」始终浮在它上方，而不是写死 124px。
  useEffect(() => {
    const composer = composerRef.current
    const root = mainRef.current
    if (root === null) return undefined
    if (composer === null || typeof ResizeObserver !== 'function') {
      root.style.removeProperty('--crew-composer-h')
      return undefined
    }
    const sync = () => root.style.setProperty('--crew-composer-h', `${composer.offsetHeight}px`)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(composer)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--crew-composer-h')
    }
  }, [room.id, room.state])

  // 只有用户的向上手势才脱离跟随；内容增长/收缩带来的 scroll 事件不能改变跟随态。
  const trackScroll = event => {
    const node = event.currentTarget
    lastTop.current = node.scrollTop
    if (atEnd(node)) {
      if (!stick.current) followBottom()
      return
    }
    if (stick.current) breakFollow()
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
      roleLabel: roleLabelOf(member),
    }))
    return list.length > 1
      ? [...list, { id: MENTION_ALL, name: '所有人', mention: '所有人', roleLabel: '每位成员' }]
      : list
  }, [room.members])

  // 交付卡里的图片读取依赖 onRead 的引用；这里保持稳定，文件缺失时不会每次渲染都重试。
  const readArtifact = useCallback((roomId, path) => store.readArtifact(roomId, path), [store])
  const actions = {
    store,
    rooms: state.rooms,
    rework: (stage, note) => store.rework(stage, note),
    chooseHuman: (stage, choice, note) => store.humanChoice(stage, choice, note),
    answerDecision: (decisionId, optionId, text) => store.answerDecision(decisionId, optionId, text),
    readArtifact: readArtifact,
    resolveMerge: () => store.resolveMerge(),
    retry: (stage, note) => void store.retry(stage, note),
    verify: stage => store.verify(stage),
    resumeChat: () => store.resumeChat(),
    resume: () => store.resumeRoom(),
    approval: (id, decisionValue) => void store.decideApproval(id, decisionValue),
    answerCard: (memberId, requestId, message) => void store.answerCard(memberId, requestId, message),
    cancelQueue: queueId => void store.cancelQueued(queueId),
    steerQueue: queueId => void store.steerQueued(queueId),
    continueChat: note => store.continueChat(note),
    selectRoom: id => store.select(id),
    startStudio: onStartStudio,
    reviewAndStartStudio: async seed => {
      // 示例房没有模型可叫；真实房才做这一步复核。
      if (room.demo === true || room.live !== true) {
        onStartStudio(seed)
        return
      }
      if (reviewInFlight.current) return
      reviewInFlight.current = true
      try {
        const result = await store.reviewChatConclusion(seed?.conclusionId ?? '')
        if (result?.ok !== true) {
          setChatReview({ error: result?.error ?? '结论复核没能开始。' })
          return
        }
        if (result.pass === true || result.skipped === true) {
          setChatReview(null)
          onStartStudio(seed)
          return
        }
        setChatReview({
          seed,
          reviewer: result.reviewer?.name ?? '复核人',
          detail: result.detail || '结论里有一句没有对话记录作依据。',
        })
      } catch (error) {
        setChatReview({ error: String(error?.message ?? error) })
      }
    },
    startChat: onStartChat,
    swapBody: memberId => {
      setSwapError(null)
      setSwapId(memberId)
    },
    forgetMemory: () => store.forgetMemory(),
    createPromise: input => store.createPromise(input),
    updatePromise: input => store.updatePromise(input),
    runPromise: () => store.runPromise(),
    keepPromise: input => store.createPromise(input),
  }
  const finished = stagesCompletedOf(room)
  const canStartRound = mode.canStartRound?.({ room }) === true
  const viewCtx = { state, room, members, locked, actions, store }
  const typing = mode.typing?.(viewCtx) ?? null
  const composerPlaceholder = mode.composerPlaceholder?.(viewCtx) ?? '对房间说话…'
  // 正在跑时，发送位就是这次回复的刹车；聊天和工作室共用同一套停下语义。
  const stopControl = turnRunning(room)
    ? h(StopReply, {
      key: `stop-${room.id}`,
      room,
      onInterrupt: () => store.interruptRoom(),
    })
    : null

  const hasFiles = event => Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const dragEnter = event => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }
  const dragOver = event => {
    if (!hasFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
  }
  const dragLeave = event => {
    if (!hasFiles(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const drop = event => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length > 0) setDropped({ id: Date.now(), files })
  }

  return h('main', {
    className: 'dsb-main crew-room',
    onDragEnter: dragEnter,
    onDragOver: dragOver,
    onDragLeave: dragLeave,
    onDrop: drop,
  },
    h('div', {
      ref: mainRef,
      className: `crew-room-main ${mode.className ?? ''}`.trim(),
      'data-room-done': finished ? 'true' : undefined,
    },
      mode.header(viewCtx),
      mode.activity(viewCtx),
      h('div', {
        ref: scroll,
        className: 'dsb-scroll crew-scroll',
        onClickCapture: holdOnExpand,
        onScroll: trackScroll,
        onWheel,
        onTouchStart,
        onTouchMove,
        onPointerDown,
      },
        h('div', { className: 'crew-flow' },
          chatReview === null
            ? null
            : h(StatePanel, {
              key: 'chat-review',
              title: chatReview.error === undefined ? '结论复核有疑问' : '结论复核没能开始',
              body: chatReview.error ?? `${chatReview.reviewer}：${chatReview.detail}`,
              tone: 'paused',
              action: h('div', { className: 'crew-state-actions' },
                h('button', {
                  type: 'button',
                  className: 'crew-ghost',
                  onClick: () => setChatReview(null),
                }, chatReview.error === undefined ? '再聊聊' : '知道了'),
                chatReview.seed === undefined
                  ? null
                  : h('button', {
                    type: 'button',
                    className: 'crew-accept',
                    onClick: () => {
                      const seed = chatReview.seed
                      setChatReview(null)
                      onStartStudio(seed)
                    },
                  }, '仍然开工')),
            }),
          mode.transcript(viewCtx),
          mode.presence(viewCtx),
          typing),
        state.error ? h('div', { className: 'crew-error', role: 'alert' }, humanErrorText(state.error)) : null),
      !atBottom && (room.messages?.length ?? 0) > 0
        ? h('button', {
          type: 'button',
          className: 'crew-jump-latest',
          'aria-label': '回到最新',
          title: '回到最新',
          onClick: followBottom,
        }, h(ArrowDownIcon))
        : null,
      h('div', { ref: composerRef, className: 'dsb-composer' },
        h(Composer, {
          members: mentionMembers,
          draftKey: room.id,
          brand: room.lodge === true,
          onSent: followBottom,
          placeholder: room.state === 'paused'
            ? '已暂停 · 继续后才能派新活'
            : room.state === 'stopped'
              ? '已停止 · 不会再派新活'
              : composerPlaceholder,
          disabled: state.phase === 'loading' || locked,
          stopControl,
          inputRef: composerInput,
          dropping: dragging,
          incoming: dropped,
          onIncomingDone: () => setDropped(null),
          onSend: (text, options) => (canStartRound
            ? store.startRound(text, options)
            : store.send(text, options)),
          onUpload: file => store.uploadAttachment(file),
        }))),
    swapId === null
      ? null
      : h(BodySwapDialog, {
        key: swapId,
        member: members.find(item => item.id === swapId) ?? { id: swapId, name: '成员', body: {} },
        canRemove: kind.id !== 'studio' && kind.id !== 'chat' && !['planner', 'lead'].includes(
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
            setSwapError(result?.error ?? '没能保存')
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
            setSwapError(result?.error ?? '没能移除成员')
            return
          }
          setSwapId(null)
        },
      }),
    )
}

export { RoomView }
