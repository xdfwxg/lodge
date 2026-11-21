import { useEffect, useRef, useState } from 'react'

const OPEN_DELAY = 180
const CLOSE_DELAY = 140

// 鼠标扫过岛面不立刻展开；先停一下，离开也留余量，避免在边缘来回抖。
export function useHoverPeek() {
  const [peeking, setPeeking] = useState(false)
  const timer = useRef(null)

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  const later = (value, delay) => {
    clear()
    timer.current = setTimeout(() => {
      timer.current = null
      setPeeking(value)
    }, delay)
  }

  useEffect(() => () => clear(), [])

  return {
    peeking,
    onPointerEnter: event => {
      if (event.pointerType !== 'touch') later(true, OPEN_DELAY)
    },
    onPointerLeave: () => later(false, CLOSE_DELAY),
    onFocus: event => {
      if (event.target.matches(':focus-visible')) {
        clear()
        setPeeking(true)
      }
    },
    onBlur: event => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        clear()
        setPeeking(false)
      }
    },
  }
}
