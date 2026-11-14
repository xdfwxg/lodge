import { useEffect, useRef } from 'react'

// Adapted from Fei2411/DS-Bot, ds-bot/src/client/overlay-hooks.js (Apache-2.0).
// Skip escapes another layer already handled and mark ours as handled, so the
// shared escape stack and sibling layers (mentions, dialogs) see this close.
export function useEscape(onEscape) {
  const handler = useRef(onEscape)
  handler.current = onEscape
  useEffect(() => {
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      handler.current?.()
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
