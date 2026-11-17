// Escape handling for the island, registered in Lodge's shared escape stack.
// The first hook came from Fei2411/DS-Bot (Apache-2.0); see
// third_party/THIRD_PARTY_NOTICES.md.

import { useEffect, useRef } from 'react'
import { registerEscapeLayer } from '../overlay.js'

// One Escape closes only the topmost layer (island vs dialogs), and prevented
// escapes (mentions) are skipped naturally.
export function useEscape(onEscape) {
  const handler = useRef(onEscape)
  handler.current = onEscape
  useEffect(() => registerEscapeLayer(() => handler.current?.()), [])
}
