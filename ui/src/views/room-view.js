import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { GoalIsland } from '../goal-island/index.js'
import { buildGoalView } from '../goal-island/model.js'
import { DeliverySheet } from '../delivery-sheet.js'
import { Composer } from '../composer.js'
import { Advanced, ReviewDialog } from '../room/advanced.js'
import { Timeline } from '../room/timeline.js'

function RoomView({ state, room, store, onContinue }) {
  const [advanced, setAdvanced] = useState(false)
  const scroll = useRef(null)
  const seenComplete = useRef(false)
  const lastId = room.messages.at(-1)?.id
  const hasDelivery = room.delivery !== null && room.delivery !== undefined

  useEffect(() => {
    seenComplete.current = false
  }, [room.id])

  useEffect(() => {
    const node = scroll.current
    if (!node) return
    if (hasDelivery && !seenComplete.current) {
      seenComplete.current = true
      node.scrollTop = 0
      return
    }
    seenComplete.current = hasDelivery
    node.scrollTop = node.scrollHeight
  }, [lastId, room.id, hasDelivery])

  const locked = room.state === 'paused' || room.state === 'stopped' || room.imported === true
  const seats = useMemo(() => {
    if (Array.isArray(room.seatSpecs) && room.seatSpecs.length > 0) return room.seatSpecs
    const ids = room.members ?? []
    return ids.length === 0 ? state.seats : state.seats.filter(seat => ids.includes(seat.id))
  }, [room.seatSpecs, room.members, state.seats])
  const goalView = useMemo(() => buildGoalView(room, seats), [room, seats])
  const goalActions = {
    review: () => void store.openReview(room.id),
    toggleAdvanced: () => setAdvanced(value => !value),
    pause: () => void store.pause(),
    resume: () => void store.resume(),
    stop: () => void store.stop(),
    ...(onContinue === undefined ? {} : { continue: () => onContinue(room) }),
  }

  return h('main', { className: 'dsb-main' },
    h(GoalIsland, { view: goalView, advanced, actions: goalActions }),
    advanced ? h(Advanced, { room, seats, store, engines: state.engines }) : null,
    state.reviewFor === room.id && state.review !== null
      ? h(ReviewDialog, { review: state.review, onClose: () => store.closeReview() })
      : null,
    h('div', { ref: scroll, className: 'dsb-scroll crew-scroll' },
      room.delivery ? h(DeliverySheet, { delivery: room.delivery, onExport: () => void store.exportDelivery() }) : null,
      h('div', { className: 'crew-flow' }, h(Timeline, {
        room,
        seats,
        onAccept: stage => void store.accept(stage),
        onAnswer: (stage, text) => void store.answer(stage, text),
        onSimulate: () => void store.simulate(),
        onSetAcceptance: (stage, command) => void store.setAcceptance(stage, command),
        onVerify: stage => void store.verify(stage),
        onApproval: (id, decision) => void store.decideApproval(id, decision),
      })),
      state.error ? h('div', { className: 'crew-error' }, state.error) : null),
    h('div', { className: 'dsb-composer' },
      h(Composer, {
        placeholder: room.imported === true
          ? '交接记录 · 只读'
          : room.state === 'complete'
          ? '这次交付已结束；说话可以开新一轮…'
          : room.state === 'paused'
            ? '已暂停 · 继续后才能派新活'
            : room.state === 'stopped'
              ? '已停止 · 不会再派新活'
              : '对房间说话…',
        disabled: state.phase === 'loading' || locked,
        onSend: text => store.send(text),
      })))
}

export { RoomView }
