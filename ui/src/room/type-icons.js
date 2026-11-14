import { createElement as h } from 'react'

const frame = (props, children) => h('svg', {
  width: props.size ?? 18,
  height: props.size ?? 18,
  viewBox: '0 0 20 20',
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}, children)

// 对话气泡：聊天室
export const ChatIcon = props => frame(props, [
  h('path', { key: 'bubble', d: 'M6 4h8a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-4l-3.5 2.5V14H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z' }),
  h('path', { key: 'lines', d: 'M7 8.2h6M7 10.8h4' }),
])

// 三层阶段：工作室
export const StudioIcon = props => frame(props, [
  h('path', { key: 'top', d: 'M10 3.2 16 6.1 10 9 4 6.1z' }),
  h('path', { key: 'mid', d: 'M4 10.2 10 13.1 16 10.2' }),
  h('path', { key: 'base', d: 'M4 14.1 10 17 16 14.1' }),
])

export const roomTypeIcon = kind => (kind === 'chat' ? ChatIcon : StudioIcon)
