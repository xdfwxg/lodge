import { useEffect, useRef } from 'react'

// 统一弹层契约：ESC 栈（后开先关）、Tab 焦点圈、焦点归还、初始焦点、背景 inert。
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

// 非弹窗层（goal island 这类 vendored 旁路）也注册进共享 ESC 栈：一次 ESC 只关
// 最上层；mention 等已 preventDefault 的事件天然被跳过。返回反注册函数。
export const registerEscapeLayer = close => {
  const entry = { el: null, close }
  ESC_STACK.push(entry)
  bindEsc()
  return () => {
    const index = ESC_STACK.indexOf(entry)
    if (index !== -1) ESC_STACK.splice(index, 1)
    unbindEscIfEmpty()
  }
}

// 背景 inert：最上层模态弹窗打开时，DOM 中不在「弹窗 → body」路径上的兄弟子树
// 全部 inert，读屏虚拟光标与指针都无法逸出弹窗。多层叠加只保护最上层，内层关
// 闭后重算即恢复外层可交互。只记录自己设过的 inert，不碰应用原本 inert 的元素；
// aria-live 区域跳过（inert 会吞掉播报）。
const OUR_INERT = new Set()
const isLiveRegion = el => el.hasAttribute('aria-live')
  || el.getAttribute('role') === 'status' || el.getAttribute('role') === 'alert'

const syncBackdropInert = () => {
  const roots = ESC_STACK
    .map(entry => entry.el)
    .filter(el => el instanceof Element && el.isConnected)
  const top = roots[roots.length - 1]
  const next = new Set()
  if (top !== undefined) {
    for (let node = top; node !== null && node !== document.body; node = node.parentElement) {
      const parent = node.parentElement
      if (parent === null) break
      for (const sibling of parent.children) {
        if (sibling !== node && !sibling.contains(top) && !isLiveRegion(sibling)) next.add(sibling)
      }
    }
  }
  for (const el of OUR_INERT) {
    if (!next.has(el)) {
      el.inert = false
      OUR_INERT.delete(el)
    }
  }
  for (const el of next) {
    if (!OUR_INERT.has(el) && el.inert !== true) {
      el.inert = true
      OUR_INERT.add(el)
    }
  }
}

// 返回应展开到弹层根元素的 props。
// active：弹层组件常驻渲染、用 open 控制显隐时传 open，确保栈只在真正打开时注册。
export const useOverlay = ({ label, onClose, modal = true, active = true }) => {
  const rootRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // autoFocus 在提交阶段就把焦点移进弹窗，effect 再取 activeElement 已经太晚；
  // 打开那一帧在渲染期记下触发元素，关闭时才能还回去。
  const restoreRef = useRef(null)
  const activeRef = useRef(false)
  if (active && !activeRef.current) {
    const current = document.activeElement
    restoreRef.current = current instanceof HTMLElement && current !== document.body ? current : null
  }
  activeRef.current = active

  useEffect(() => {
    if (!active) return undefined
    const el = rootRef.current
    if (el === null) return undefined
    const restoreTo = restoreRef.current
    const entry = { el: modal ? el : null, close: () => closeRef.current() }
    ESC_STACK.push(entry)
    bindEsc()
    syncBackdropInert()
    // 初始焦点：内部已有聚焦元素（如 autoFocus 输入框）就不抢，否则聚焦根元素。
    if (!(document.activeElement instanceof Node) || !el.contains(document.activeElement)) {
      el.focus({ preventScroll: true })
    }
    return () => {
      const index = ESC_STACK.indexOf(entry)
      if (index !== -1) ESC_STACK.splice(index, 1)
      unbindEscIfEmpty()
      // 先重算 inert（外层弹窗要恢复可交互、可聚焦），再归还焦点。
      syncBackdropInert()
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) {
        restoreTo.focus({ preventScroll: true })
      }
      restoreRef.current = null
    }
  }, [active])

  const onKeyDown = event => {
    if (event.key !== 'Tab') return
    const el = rootRef.current
    if (el === null) return
    const items = Array.from(el.querySelectorAll(FOCUSABLE))
      .filter(node => node.disabled !== true && (node.checkVisibility?.() ?? node.offsetParent !== null))
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
