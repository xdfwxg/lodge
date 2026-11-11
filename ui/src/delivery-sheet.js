import { createElement as h } from 'react'

const timeOf = ts => {
  if (typeof ts !== 'number') return ''
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts))
  } catch {
    return ''
  }
}

const short = hash => (typeof hash === 'string' && hash.length > 12 ? hash.slice(0, 12) : hash)

// 完成态先看到交付单，聊天退到下方；数据全部来自房间投影，不在 UI 重算业务结论。
export function DeliverySheet({ delivery }) {
  const commands = delivery.commands ?? []
  const passed = commands.filter(command => command.exit === 0).length
  return h('section', { className: 'crew-delivery', 'aria-label': '交付单' },
    h('div', { className: 'crew-delivery-head' },
      h('div', { className: 'crew-delivery-title' },
        h('span', { className: 'crew-delivery-kicker' }, '交付单'),
        h('h2', null, delivery.name ?? '这次交付'),
        h('p', null, delivery.goal ?? '')),
      h('span', { className: 'crew-verdict', 'data-pass': true }, '目标达成')),
    h('div', { className: 'crew-delivery-metrics' },
      h('span', null, `${delivery.stages?.filter(stage => stage.state === 'passed').length ?? 0}/${delivery.stages?.length ?? 0} 阶段`),
      h('span', null, `${passed}/${commands.length} 命令通过`),
      h('span', null, `${delivery.changedFiles?.length ?? 0} 个文件`),
      delivery.independenceLabel ? h('span', null, delivery.independenceLabel) : null,
      delivery.completedAt ? h('span', null, timeOf(delivery.completedAt)) : null),
    delivery.commit
      ? h('div', { className: 'crew-delivery-commit' },
        h('span', null, '结论 commit'),
        h('code', null, short(delivery.commit)),
        h('span', null, '未 push'))
      : h('div', { className: 'crew-delivery-commit' },
        h('span', null, delivery.workspace?.vcs === 'git' ? '没有新的 commit' : `留痕方式：${delivery.workspace?.vcs === 'none' ? '房间记录归档' : delivery.workspace?.vcs}`)),
    h('div', { className: 'crew-delivery-stages' },
      ...(delivery.stages ?? []).map(stage => h('div', { key: stage.index, className: 'crew-delivery-stage' },
        h('div', { className: 'crew-delivery-stage-head' },
          h('b', null, `${stage.index + 1}. ${stage.title}`),
          h('span', { 'data-state': stage.state }, stage.kind === 'deliverable' ? '交付' : '决策')),
        stage.acceptance ? h('div', { className: 'crew-kv' },
          h('span', null, '验收'),
          h('code', null, stage.acceptance)) : null,
        ...stage.commands.map(command => h('div', { key: command.id, className: 'crew-kv' },
          h('span', null, '命令'),
          h('code', null, `${command.command} · exit ${command.exit === null ? '无' : command.exit}`))),
        ...stage.verdicts
          .map(verdict => h('div', { key: verdict.id, className: 'crew-delivery-verdict', 'data-pass': verdict.pass },
            h('span', null, delivery.seatNames?.[verdict.authorId] ?? verdict.authorId),
            h('b', null, verdict.pass ? 'PASS' : 'REJECT'))),
        stage.changedFiles?.length
          ? h('details', { className: 'crew-fold' },
            h('summary', null, `改动文件 ${stage.changedFiles.length}`),
            h('ul', null, stage.changedFiles.map(file => h('li', { key: file }, h('code', null, file)))))
          : null))),
    delivery.changedFiles?.length
      ? h('details', { className: 'crew-fold crew-delivery-files' },
        h('summary', null, `全部改动文件 · ${delivery.changedFiles.length}`),
        h('ul', null, delivery.changedFiles.map(file => h('li', { key: file }, h('code', null, file)))))
      : null)
}
