import { createElement as h, useEffect, useState } from 'react'

// 只读回放：解释已有的转移审计事件，不写房间、不补事件。
export function ReplayDialog({ replay, onClose }) {
  const steps = replay?.steps ?? []
  const [index, setIndex] = useState(Math.max(0, steps.length - 1))
  useEffect(() => {
    setIndex(Math.max(0, steps.length - 1))
  }, [replay?.roomId, steps.length])
  const step = steps[index] ?? null
  const summary = replay?.summary ?? { total: 0, invalid: 0, finalState: '' }
  const context = step === null ? {} : step.context ?? {}
  return h('div', { className: 'crew-overlay', onClick: onClose },
    h('div', { className: 'crew-dialog crew-replay', onClick: event => event.stopPropagation() },
      h('div', { className: 'crew-dialog-head' },
        h('div', null,
          h('h2', null, '状态回放'),
          h('p', { className: 'crew-dialog-sub' },
            `${replay?.roomType === 'chat' ? '聊天室' : '工作室'} · 只读 · 房间最终状态 ${summary.finalState ?? '未知'}`)),
        h('button', {
          type: 'button',
          className: 'crew-dialog-close',
          'aria-label': '关闭',
          title: '关闭',
          onClick: onClose,
        }, '×')),
      h('div', { className: 'crew-dialog-body crew-replay-body' },
        h('div', { className: 'crew-replay-stats' },
          h('div', { className: 'crew-review-stat' }, h('span', null, '迁移'), h('b', null, String(summary.total))),
          h('div', { className: 'crew-review-stat' }, h('span', null, '非法'), h('b', null, String(summary.invalid))),
          h('div', { className: 'crew-review-stat' }, h('span', null, '当前状态'), h('b', null, summary.finalState ?? '未知'))),
        steps.length === 0
          ? h('p', { className: 'crew-muted' }, '还没有状态迁移记录。')
          : h('div', { className: 'crew-replay-list' },
            steps.map(item => h('button', {
              key: item.id,
              type: 'button',
              className: 'crew-replay-step',
              'data-on': item.index === index + 1 ? 'true' : undefined,
              'data-bad': item.ok ? undefined : 'true',
              onClick: () => setIndex(item.index - 1),
            }, `#${item.index} ${item.from} → ${item.event} → ${item.to}`))),
        step === null
          ? null
          : h('div', { className: 'crew-replay-detail' },
            h('div', { className: 'crew-replay-line' },
              h('b', null, `${step.from} → ${step.to}`),
              h('span', { className: 'crew-muted' }, `事件 ${step.event} · ${step.actor || '未知操作者'}`)),
            h('div', { className: 'crew-muted' }, step.reason || '没有记录原因'),
            Object.keys(context).length === 0
              ? h('div', { className: 'crew-muted' }, '上下文：未记录')
              : h('pre', { className: 'crew-replay-context' }, JSON.stringify(context, null, 2)),
            step.ok
              ? h('div', { className: 'crew-replay-ok' }, '这条迁移符合当前转移表。')
              : h('div', { className: 'crew-replay-bad' }, step.issues.join('；'))),
        steps.length > 0
          ? h('div', { className: 'crew-replay-actions' },
            h('button', {
              type: 'button',
              className: 'crew-ghost',
              disabled: index <= 0,
              onClick: () => setIndex(current => Math.max(0, current - 1)),
            }, '上一条'),
            h('span', { className: 'crew-muted' }, `${index + 1} / ${steps.length}`),
            h('button', {
              type: 'button',
              className: 'crew-ghost',
              disabled: index >= steps.length - 1,
              onClick: () => setIndex(current => Math.min(steps.length - 1, current + 1)),
            }, '下一条'))
          : null)))
}
