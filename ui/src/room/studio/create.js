import { createElement as h } from 'react'

// 工作室建房字段：影子评审、跨厂商要求和项目约束；聊天室不出现这些。
export function StudioSetupFields({
  shadowReview,
  onShadowReview,
  requireIndependent,
  onRequireIndependent,
  constraintsView,
}) {
  return h('div', null,
    h('label', { className: 'crew-check' },
      h('input', {
        type: 'checkbox',
        checked: shadowReview,
        onChange: event => onShadowReview(event.target.checked),
      }),
      '影子评审：评估建议只记录，不注入验收员'),
    h('label', { className: 'crew-check' },
      h('input', {
        type: 'checkbox',
        checked: requireIndependent,
        onChange: event => onRequireIndependent(event.target.checked),
      }),
      '严格要求跨厂商复核：没有第二厂商时拒绝建房'),
    constraintsView)
}
