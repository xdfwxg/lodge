import { createElement as h, useState } from 'react'
import { useOverlay } from '../overlay.js'
import { ROOM_POLICY_OPTIONS, roomPolicyOf } from '../../../shared/room-policy.js'
import { uiKindOfRoom } from './kinds.js'

// 房间的三项权限：改文件、上网、外部动作。一屏三个决定，默认是最稳的那一列。
// 文字只描述用户能感觉到的后果，不出现内部机制词。
export function PermissionDialog({ room, busy = false, onSave, onClose }) {
  const [policy, setPolicy] = useState(() => roomPolicyOf(room))
  const overlay = useOverlay({ label: '房间权限', onClose, active: true })
  const choose = (key, value) => setPolicy(current => ({ ...current, [key]: value }))
  // 聊天室不碰文件，改文件那一组不展示，也不假装能设。
  const chat = uiKindOfRoom(room).id === 'chat'
  // “只连模型”靠基座的按成员边界；有成员用的模型收不到这个声明时，这一档不能选。
  const boundaryReady = (room.members ?? []).every(member => !member.body?.engine || member.body.engine === 'pi')
  const groups = [
    ...(chat ? [] : [{ key: 'files', title: '改文件', hint: '它只能动这间房的工作副本；选了“每一步都问”，跑命令也要先等你。' }]),
    { key: 'network', title: '上网', hint: '模型总是要连的；允许的网站由这台电脑的设置决定。' },
    ...(chat ? [] : [{ key: 'external', title: '外部动作', hint: '常见的危险命令（推送、安装、删除）先停下来等你；不认识的脚本可能直接跑。要每一步都问，选“改文件”里的那一档。' }]),
  ]
  const optionOf = (group, option) => {
    const blocked = busy || (group.key === 'network' && option.value === 'model' && !boundaryReady)
    return h('label', {
      key: option.value,
      className: 'crew-permission-option',
      'data-checked': policy[group.key] === option.value ? 'true' : undefined,
      title: group.key === 'network' && option.value === 'model' && !boundaryReady
        ? '这间房里有成员的模型不支持这项限制'
        : undefined,
    },
    h('input', {
      type: 'radio',
      name: `policy-${group.key}`,
      value: option.value,
      checked: policy[group.key] === option.value,
      disabled: blocked,
      onChange: () => choose(group.key, option.value),
    }),
    h('span', null, option.label))
  }
  const groupOf = group => h('fieldset', { key: group.key, className: 'crew-permission-group' },
    h('legend', null, group.title),
    h('p', { className: 'crew-permission-hint' }, group.hint),
    h('div', {
      className: 'crew-permission-options',
      role: 'radiogroup',
      'aria-label': group.title,
    }, ROOM_POLICY_OPTIONS[group.key].map(option => optionOf(group, option))))
  return h('div', {
    className: 'crew-overlay crew-overlay-center',
    onClick: () => { if (!busy) onClose() },
    ...overlay,
  },
  h('div', {
    className: 'crew-dialog crew-permission',
    onClick: event => event.stopPropagation(),
  },
  h('div', { className: 'crew-dialog-heading' },
    h('h2', null, '这间房能做什么'),
    h('p', null, '默认是最稳的一档：只在允许的范围内做事，高风险动作先停下来问你。')),
  h('div', { className: 'crew-permission-groups' }, groups.map(group => groupOf(group))),
  h('div', { className: 'crew-dialog-foot' },
    h('button', { type: 'button', className: 'crew-ghost', disabled: busy, onClick: onClose }, '取消'),
    h('button', {
      type: 'button',
      className: 'crew-accept crew-dialog-primary',
      disabled: busy,
      onClick: () => onSave(policy),
    }, busy ? '正在保存…' : '保存'))))
}
