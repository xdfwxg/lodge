import { createElement as h, useEffect, useState } from 'react'

const ACTIONS = {
  bash: '正在运行命令',
  shell: '正在运行命令',
  read: '正在读取文件',
  write: '正在写入文件',
  edit: '正在修改文件',
  multiedit: '正在修改文件',
  grep: '正在查找内容',
  glob: '正在查找文件',
  websearch: '正在查资料',
  webfetch: '正在读取网页',
  navigate_page: '正在打开网页',
  take_snapshot: '正在读取网页',
  take_screenshot: '正在看页面',
  list_pages: '正在查看页面',
  new_page: '正在打开页面',
  select_page: '正在切换页面',
}

const bareName = tool => {
  const name = String(tool ?? '')
  return name.startsWith('mcp__') ? name.split('__').at(-1) : name
}

export const workingActionOf = tool => ACTIONS[bareName(tool).toLowerCase()] ?? '正在处理'

const elapsedText = (from, now) => {
  const seconds = Math.max(0, Math.floor((now - from) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

// 工具在跑时只占一行：有动效、有时长；展开才看工具名，不把命令铺到主视线。
export function WorkingLine({ activity, memberName = '' }) {
  const from = typeof activity?.ts === 'number' ? activity.ts : Date.now()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const action = workingActionOf(activity?.meta?.tool ?? activity?.text)
  return h('details', { className: 'crew-work-line' },
    h('summary', null,
      h('span', { className: 'crew-work-dots', 'aria-hidden': true }, h('i'), h('i'), h('i')),
      memberName === '' ? null : h('span', { className: 'crew-work-name' }, memberName),
      h('span', { className: 'crew-work-action' }, action),
      h('span', { className: 'crew-work-elapsed' }, elapsedText(from, now)),
      h('span', { className: 'crew-work-chevron', 'aria-hidden': true }, '›')),
    h('div', { className: 'crew-work-detail' },
      h('span', null, '工具'),
      h('code', null, bareName(activity?.meta?.tool ?? activity?.text) || '工具')))
}
