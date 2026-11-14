import { useEffect, useRef } from 'react'
import { registerEscapeLayer } from '../overlay.js'

// Adapted from Fei2411/DS-Bot, ds-bot/src/client/overlay-hooks.js (Apache-2.0).
// Lodge change: escapes are registered in the app's shared escape stack instead
// of a private window listener, so one Escape closes only the topmost layer
// (island vs dialogs) and prevented escapes (mentions) are skipped naturally.
export function useEscape(onEscape) {
  const handler = useRef(onEscape)
  handler.current = onEscape
  useEffect(() => registerEscapeLayer(() => handler.current?.()), [])
}
