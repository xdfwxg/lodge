import { useEffect, useReducer, useRef, useState } from 'react'
import { baselineSeen, decisionOf, milestoneOf } from './signal.js'
import { PEEK_MS, initialIslandState, peekRemaining, reduceIsland } from './island-machine.js'

const typing = () => {
  if (typeof document === 'undefined') return false
  if (document.hidden === true) return true
  const active = document.activeElement
  return active instanceof HTMLElement && active.matches('input, textarea, [contenteditable="true"]')
}

// The adapter only wires actions; this hook owns the attention state:
// baseline the room once, then let at most one event at a time through.
export const useGoalSignal = room => {
  const [state, dispatch] = useReducer(reduceIsland, initialIslandState)
  const previous = useRef(null)
  const seen = useRef(new Set())
  const [paused, setPaused] = useState(false)
  const remaining = useRef(PEEK_MS)

  useEffect(() => {
    const decision = decisionOf(room)
    if (previous.current === null || previous.current.id !== room.id) {
      seen.current = baselineSeen(room)
      previous.current = room
      dispatch({ type: 'reset' })
      dispatch({ type: 'snapshot', decision, milestone: null, now: Date.now() })
      return
    }
    const { event, seen: nextSeen } = milestoneOf(previous.current, room, seen.current)
    seen.current = nextSeen
    previous.current = room
    dispatch({
      type: 'snapshot',
      decision,
      milestone: typing() ? null : event,
      now: Date.now(),
    })
  }, [room])

  useEffect(() => {
    if (state.mode !== 'peek' || paused) return undefined
    const delay = peekRemaining(state.expiresAt)
    if (delay <= 0) {
      dispatch({ type: 'elapse', key: state.signal?.key })
      return undefined
    }
    const timer = setTimeout(() => dispatch({ type: 'elapse', key: state.signal?.key }), delay)
    return () => clearTimeout(timer)
  }, [state.mode, state.expiresAt, state.signal?.key, paused])

  useEffect(() => {
    if (state.mode !== 'peek') setPaused(false)
  }, [state.mode])

  const onOpen = () => dispatch({ type: 'open' })
  const onClose = () => dispatch({ type: 'close', decision: decisionOf(room) })
  const onDismiss = () => dispatch({ type: 'dismiss' })
  const onPause = () => {
    if (state.mode !== 'peek') return
    remaining.current = peekRemaining(state.expiresAt)
    setPaused(true)
  }
  const onResume = () => {
    setPaused(false)
    if (state.mode !== 'peek') return
    dispatch({ type: 'resume', now: Date.now(), remaining: remaining.current })
  }

  return {
    mode: state.mode,
    signal: state.signal,
    paused,
    onOpen,
    onClose,
    onDismiss,
    onPause,
    onResume,
  }
}
