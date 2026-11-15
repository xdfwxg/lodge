import { createElement as h, useId } from 'react'

function Section({ label, items, warning = false }) {
  if (items.length === 0) return null
  return h('div', { className: `crew-handoff-section${warning ? ' is-warning' : ''}` },
    h('b', null, label),
    h('ul', null, items.map((item, index) => h('li', { key: `${label}-${index}` }, item))))
}

export const gateCardState = ({
  needsReview,
  reviewed,
  verify = 'manual',
  acceptance = '',
  plannedAcceptance = false,
}) => {
  const missingCommand = verify === 'test' && acceptance.trim() === '' && plannedAcceptance !== true
  const ready = (!needsReview || reviewed) && !missingCommand
  return {
    ready,
    status: ready ? '可以开工' : needsReview && !reviewed ? '有分歧' : '还差检查命令',
    pendingText: ready
      ? null
      : needsReview && !reviewed ? '先确认这些分歧，再开工。' : '填写检查命令后再开工。',
  }
}

// Gate 的决策卡：五字段、检查方式和分歧确认都在这里，不再分散到高级设置。
export function HandoffReview({
  handoff,
  reviewed,
  onReviewed,
  sourceName = '',
  verify = 'manual',
  acceptance = '',
  plannedAcceptance = false,
  onVerifyMode = null,
  onAcceptanceDraft = null,
}) {
  const id = useId()
  const needsReview = handoff.disagreements.length > 0
  const { ready, status } = gateCardState({ needsReview, reviewed, verify, acceptance, plannedAcceptance })
  const editable = typeof onVerifyMode === 'function'
  const sourceLabel = sourceName === '' ? '来自聊天室的交接' : `来自「${sourceName}」的交接`
  return h('div', { className: 'crew-card crew-handoff-review' },
    h('div', { className: 'crew-card-head' },
      h('span', { className: 'crew-handoff-source', title: sourceLabel }, sourceLabel),
      h('span', {
        className: 'crew-verdict',
        'data-pending': ready ? undefined : true,
        'data-pass': ready ? true : undefined,
      }, status)),
    h('div', { className: 'crew-card-body' },
      h('p', { className: 'crew-handoff-topic' }, handoff.topic),
      Section({ label: '共识', items: handoff.consensus }),
      Section({ label: '还没解决的分歧', items: handoff.disagreements, warning: true }),
      Section({ label: '约束', items: handoff.constraints }),
      Section({ label: '待办', items: handoff.todos }),
      h('div', { className: 'crew-gate-check' },
        h('b', null, '开工后'),
        editable
          ? h('div', { className: 'crew-choice-row', role: 'group', 'aria-label': '检查方式' },
            h('button', {
              type: 'button',
              className: 'crew-choice',
              'data-on': verify === 'manual' ? 'true' : undefined,
              'aria-pressed': verify === 'manual',
              onClick: () => onVerifyMode('manual'),
            }, '我自己看'),
            h('button', {
              type: 'button',
              className: 'crew-choice',
              'data-on': verify === 'test' ? 'true' : undefined,
              'aria-pressed': verify === 'test',
              onClick: () => onVerifyMode('test'),
            }, '跑一条检查'))
          : null,
        verify === 'test'
          ? editable
            ? h('input', {
              className: 'crew-goal-input',
              type: 'text',
              'aria-label': '检查命令',
              placeholder: '例如：npm test',
              value: acceptance,
              onChange: event => onAcceptanceDraft(event.target.value),
            })
            : plannedAcceptance
              ? h('p', { className: 'crew-field-hint' }, '每个交付阶段跑一条检查')
              : h('p', { className: 'crew-field-hint' }, acceptance === '' ? '还没填检查命令' : `跑一条检查：${acceptance}`)
          : h('p', { className: 'crew-field-hint' }, '你来看结果，再决定下一步')),
      needsReview
        ? h('label', { className: 'crew-check', htmlFor: id },
          h('input', {
            id,
            type: 'checkbox',
            checked: reviewed,
            onChange: event => onReviewed(event.target.checked),
          }),
          '我看过这些分歧，决定继续')
        : null))
}
