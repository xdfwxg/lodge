import { createElement as h, useState } from 'react'
import { Segmented } from '../segmented.js'
import { useOverlay } from '../overlay.js'
import {
  ROOM_ACCESS,
  ROOM_ACCESS_OPTIONS,
  roomAccessOf,
  roomHasBrowserCapability,
} from '../../../shared/room-access.js'

// 右上角只留一个“权限”；点开用弹框说明两档，不把说明常驻在界面上。
export function BrowserPermission({ room, onChange = null }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(roomAccessOf(room))
  const overlay = useOverlay({
    label: '房间权限',
    onClose: () => setOpen(false),
    active: open,
  })
  if (room?.state === 'complete' || !roomHasBrowserCapability(room) || roomAccessOf(room) !== ROOM_ACCESS.PUBLIC_WEB) return null
  const openDialog = () => {
    setValue(roomAccessOf(room))
    setOpen(true)
  }
  const save = () => {
    onChange?.(value)
    setOpen(false)
  }
  return h('div', { className: 'crew-permission' },
    h('button', { type: 'button', className: 'crew-link', onClick: openDialog }, '免确认'),
    open
      ? h('div', { className: 'crew-overlay', onClick: () => setOpen(false), ...overlay },
        h('div', {
          className: 'crew-dialog crew-permission-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '查网页时',
          onClick: event => event.stopPropagation(),
        },
        h('div', { className: 'crew-dialog-heading' },
          h('h2', null, '查网页时'),
          h('p', null, '只作用于这个房间，不影响其他房间。')),
        h('div', { className: 'crew-dialog-body' },
          h(Segmented, {
            label: '查网页时',
            value,
            options: ROOM_ACCESS_OPTIONS,
            onChange: setValue,
          }),
          h('p', { className: 'crew-dialog-note' }, value === ROOM_ACCESS.PUBLIC_WEB
            ? '房间免确认：只读研究不再逐次确认；命令、文件和付款仍要确认。'
            : '每次确认：每次查网页都会先问你。')),
        h('div', { className: 'crew-dialog-foot' },
          h('button', { type: 'button', className: 'crew-ghost', onClick: () => setOpen(false) }, '取消'),
          h('button', { type: 'button', className: 'crew-accept crew-dialog-primary', onClick: save }, '保存'))))
      : null)
}
