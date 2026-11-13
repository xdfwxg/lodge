import { createElement as h } from 'react'

const STATUS = {
  agree: { label: '一致', tone: 'ok' },
  disagree: { label: '分歧', tone: 'bad' },
  neutral: { label: '中性', tone: 'muted' },
  pending: { label: '待定', tone: 'muted' },
  mixed: { label: '多票不一', tone: 'warn' },
  missing: { label: '无 advisor 建议', tone: 'muted' },
}

const exportDisagreements = review => {
  const rows = (review.rows ?? []).filter(row => row.status === 'disagree' || row.status === 'mixed')
  const payload = {
    exportedAt: new Date().toISOString(),
    summary: review.summary,
    rows,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'shadow-review-disagreements.json'
  link.click()
  URL.revokeObjectURL(url)
}

export function ShadowDialog({ review, focus = null, onClose }) {
  const rows = review?.rows ?? []
  const summary = review?.summary ?? {}
  return h('div', { className: 'crew-overlay', onClick: onClose },
    h('div', { className: 'crew-dialog crew-shadow', onClick: event => event.stopPropagation() },
      h('div', { className: 'crew-dialog-head' },
        h('div', null,
          h('h2', null, '影子评审对照'),
          h('p', { className: 'crew-dialog-sub' }, '左侧 Verifier 决定流转与签字；右侧 advisor 只做对照，不参与门禁。')),
        h('button', {
          type: 'button',
          className: 'crew-dialog-close',
          'aria-label': '关闭',
          title: '关闭',
          onClick: onClose,
        }, '×')),
      h('div', { className: 'crew-dialog-body crew-shadow-body' },
        h('div', { className: 'crew-shadow-stats' },
          h('span', null, `凭证 ${summary.total ?? 0}`),
          h('span', { 'data-tone': 'ok' }, `一致 ${summary.agree ?? 0}`),
          h('span', { 'data-tone': 'bad' }, `分歧 ${summary.disagree ?? 0}`),
          h('span', null, `中性 ${summary.neutral ?? 0}`),
          h('span', null, `无建议 ${summary.missing ?? 0}`)),
        rows.length === 0
          ? h('p', { className: 'crew-muted' }, '还没有可对照的凭证。')
          : h('div', { className: 'crew-shadow-list' },
            rows.map(row => {
              const status = STATUS[row.status] ?? STATUS.pending
              return h('div', {
                key: row.evidenceId,
                className: 'crew-shadow-row',
                'data-tone': status.tone,
                'data-focus': row.evidenceId === focus ? 'true' : undefined,
              },
                h('div', { className: 'crew-shadow-row-head' },
                  h('b', null, `阶段 ${row.stage + 1} · ${row.kind === 'manual' ? '人工产物' : row.command || '验收命令'}`),
                  h('span', { className: 'crew-shadow-status', 'data-tone': status.tone }, status.label)),
                h('div', { className: 'crew-shadow-cols' },
                  h('div', { className: 'crew-shadow-col' },
                    h('div', { className: 'crew-shadow-col-head' }, 'Verifier（正式）'),
                    row.verdicts.length === 0
                      ? h('div', { className: 'crew-muted' }, '还没有 verdict')
                      : row.verdicts.map((verdict, index) => h('div', { key: `${row.evidenceId}-v${index}`, className: 'crew-shadow-verdict' },
                        h('b', { 'data-pass': verdict.pass ? 'true' : 'false' }, verdict.pass ? 'PASS' : 'REJECT'),
                        h('span', null, verdict.authorId),
                        verdict.reason === '' ? null : h('p', null, verdict.reason.slice(0, 180))))),
                  h('div', { className: 'crew-shadow-col' },
                    h('div', { className: 'crew-shadow-col-head' }, 'advisor（仅对照）'),
                    row.advice === null
                      ? h('div', { className: 'crew-muted' }, '这次没有记录 advisor 建议')
                      : h('div', null,
                        h('div', { className: 'crew-shadow-score' },
                          h('b', null, row.advice.score === null ? '无分数' : row.advice.score.toFixed(2)),
                          row.advice.shadow ? h('span', null, '影子') : null,
                          row.advice.model === '' ? null : h('span', null, row.advice.model)),
                        row.advice.summary === '' ? null : h('p', null, row.advice.summary),
                        row.advice.reasons.length === 0 ? null : h('p', { className: 'crew-muted' }, `理由：${row.advice.reasons.join('；')}`),
                        row.advice.risks.length === 0 ? null : h('p', { className: 'crew-muted' }, `风险：${row.advice.risks.join('；')}`),
                        row.advice.missingEvidence.length === 0 ? null : h('p', { className: 'crew-muted' }, `缺少：${row.advice.missingEvidence.join('；')}`)))))
            })),
        h('div', { className: 'crew-shadow-foot' },
          h('span', { className: 'crew-muted' }, '只读对照；advisor 不写 verdict、不触发状态迁移。'),
          h('button', {
            type: 'button',
            className: 'crew-choice',
            disabled: rows.every(row => row.status !== 'disagree' && row.status !== 'mixed'),
            onClick: () => exportDisagreements(review),
          }, '导出分歧 JSON')))))
}
