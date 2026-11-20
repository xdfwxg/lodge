import { Fragment, createElement as h } from 'react'
import { Segmented } from '../segmented.js'

// 两种房型共用的验收选择：工作室直接用，聊天室转工作室的交接卡也用它。
export function VerifyChoice({
  verifyMode = 'manual',
  onVerifyMode = () => {},
  acceptanceDraft = '',
  onAcceptanceDraft = () => {},
  disabled = false,
}) {
  return h(Fragment, null,
    h(Segmented, {
      label: '怎么验收',
      value: verifyMode,
      onChange: onVerifyMode,
      disabled,
      options: [
        { value: 'manual', label: '我自己看' },
        { value: 'test', label: '跑一条检查' },
      ],
    }),
    verifyMode === 'test'
      ? h('input', {
        className: 'crew-goal-input',
        type: 'text',
        'aria-label': '要跑的检查',
        placeholder: '例如：npm test',
        value: acceptanceDraft,
        disabled,
        onChange: event => onAcceptanceDraft(event.target.value),
      })
      : null)
}
