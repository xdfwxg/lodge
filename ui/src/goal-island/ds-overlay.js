import { useEffect, useRef } from 'react'

// Adapted from Fei2411/DS-Bot, ds-bot/src/client/overlay-hooks.js (Apache-2.0).
export function useEscape(onEscape) {
  const handler = useRef(onEscape)
  handler.current = onEscape
  useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') handler.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
