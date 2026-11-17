const scrollParentOf = node => {
  let current = node.parentElement
  while (current !== null && current !== document.body) {
    const style = getComputedStyle(current)
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 1) return current
    current = current.parentElement
  }
  return null
}

// 展开详情只改变点击位置以下的内容；浏览器偶尔会按别的锚点挪滚动位置。
// 以被点击的 summary 为锚，展开/收起后把它放回原来的屏幕位置。
export const installSummaryScrollGuard = () => {
  const onClick = event => {
    const summary = event.target?.closest?.('summary')
    if (summary === null || summary === undefined) return
    const scroller = scrollParentOf(summary)
    if (scroller === null) return
    const before = summary.getBoundingClientRect().top
    const restore = () => {
      if (!summary.isConnected || !scroller.isConnected) return
      const delta = summary.getBoundingClientRect().top - before
      if (Math.abs(delta) > 0.5) scroller.scrollTop += delta
    }
    requestAnimationFrame(() => {
      restore()
      setTimeout(restore, 80)
    })
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
