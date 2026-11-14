import { useEffect, useRef } from 'react'

// 统一弹层契约：ESC 栈（后开先关）、Tab 焦点圈、焦点归还、初始焦点。
// 只做行为约定，不做视觉；不触碰 store 与传输层。

const ESC_STACK = []
const FOCUSABLE = 'button,input,textarea,select,a[href],[tabindex]:not([tabindex="-1"])'

let escBound = false

const onDocumentKeydown = event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  const top = ESC_STACK[ESC_STACK.length - 1]
  if (top !== undefined) top.close()
}

const bindEsc = () => {
  if (escBound) return
  document.addEventListener('keydown', onDocumentKeydown)
  escBound = true
}

const unbindEscIfEmpty = () => {
  if (escBound && ESC_STACK.length === 0) {
    document.removeEventListener('keydown', onDocumentKeydown)
    escBound = false
  }
}

// 返回应展开到弹层根元素的 props。
// active：弹层组件常驻渲染、用 open 控制显隐时传 open，确保栈只在真正打开时注册。
export const useOverlay = ({ label, onClose, modal = true, active = true }) => {
  const rootRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!active) return undefined
    const el = rootRef.current
    if (el === null) return undefined
    const restoreTo = document.activeElement
    const entry = { el, close: () => closeRef.current() }
    ESC_STACK.push(entry)
    bindEsc()
    // 初始焦点：内部已有聚焦元素（如 autoFocus 输入框）就不抢，否则聚焦根元素。
    if (!(document.activeElement instanceof Node) || !el.contains(document.activeElement)) {
      el.focus({ preventScroll: true })
    }
    return () => {
      const index = ESC_STACK.indexOf(entry)
      if (index !== -1) ESC_STACK.splice(index, 1)
      unbindEscIfEmpty()
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) {
        restoreTo.focus({ preventScroll: true })
      }
    }
  }, [active])

  const onKeyDown = event => {
    if (event.key !== 'Tab') return
    const el = rootRef.current
    if (el === null) return
    const items = Array.from(el.querySelectorAll(FOCUSABLE))
      .filter(node => node.disabled !== true)
    if (items.length === 0) {
      event.preventDefault()
      el.focus({ preventScroll: true })
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const activeEl = document.activeElement
    const inside = activeEl instanceof Node && el.contains(activeEl)
    if (!event.shiftKey && (!inside || activeEl === last)) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && (!inside || activeEl === first)) {
      event.preventDefault()
      last.focus()
    }
  }

  return {
    ref: rootRef,
    role: 'dialog',
    'aria-modal': modal ? 'true' : 'false',
    'aria-label': label,
    tabIndex: -1,
    onKeyDown,
  }
}
