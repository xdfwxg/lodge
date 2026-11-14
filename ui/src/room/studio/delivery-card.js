import { createElement as h, useState } from 'react'
import { openPath as openTarget } from '../../system.js'

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
const joinPath = (base, file) => file.startsWith('/') ? file : `${base.replace(/\/$/, '')}/${file}`

// 交付是房间的最后一次发言：外壳与聊天结论卡一致，完整明细收在卡内。
export function DeliveryCard({ delivery, onExport }) {
  const commands = delivery.commands ?? []
  const passed = commands.filter(command => command.exit === 0).length
  const [openError, setOpenError] = useState(null)
  const [openNotice, setOpenNotice] = useState(null)
  const open = async target => {
    try {
      setOpenError(null)
      await openTarget(target)
      setOpenNotice('已打开')
      setTimeout(() => setOpenNotice(null), 2000)
    } catch (error) {
      setOpenError(`打开失败：${String(error?.message ?? error)}`)
    }
  }
  const goalText = typeof delivery.goal === 'string' ? delivery.goal.replace(/\*\*/g, '').trim() : ''
  const goalFirst = goalText.split('\n').map(line => line.trim()).find(line => line !== '') ?? ''
  const nameText = typeof delivery.name === 'string' ? delivery.name.trim() : ''
  const signoff = [
    delivery.completedAt ? timeOf(delivery.completedAt) : '',
    delivery.independenceLabel ?? '',
  ].filter(Boolean).join(' · ')
  return h('div', { className: 'crew-msg-conclusion' },
    h('div', { className: 'crew-card crew-conclusion', 'data-settled': 'true', 'aria-label': '交付单' },
      h('div', { className: 'crew-card-body' },
        h('b', { className: 'crew-conclusion-title' }, '交付单'),
        h('p', { className: 'crew-delivery-name' }, nameText === '' ? '这次交付' : nameText),
        goalFirst === '' || goalFirst === nameText ? null : h('p', { className: 'crew-field-hint' }, goalFirst),
        goalText !== goalFirst
          ? h('details', { className: 'crew-fold' },
            h('summary', null, '完整目标'),
            h('p', { className: 'crew-field-hint' }, goalText))
          : null,
        h('div', { className: 'crew-delivery-metrics' },
          h('span', null, `${delivery.stages?.filter(stage => stage.state === 'passed').length ?? 0}/${delivery.stages?.length ?? 0} 阶段`),
          h('span', null, commands.length > 0 ? `${passed}/${commands.length} 命令通过` : '人工验收'),
          h('span', null, `${(delivery.artifacts?.length ?? 0) > 0 ? delivery.artifacts.length : delivery.changedFiles?.length ?? 0} 个文件`),
          delivery.integrity
            ? h('span', { 'data-bad': delivery.integrity.ok === false ? 'true' : undefined },
              delivery.integrity.ok === false
                ? `账本 ${delivery.integrity.broken.length}/${delivery.integrity.total} 条异常`
                : `账本 ${delivery.integrity.verified}/${delivery.integrity.total} 条一致`)
            : null),
        h('div', { className: 'crew-kv' },
          h('span', null, '提交'),
          delivery.commit
            ? h('code', null, short(delivery.commit))
            : h('span', null, delivery.workspace?.vcs === 'git' ? '没有新的 commit' : `留痕：${delivery.workspace?.vcs === 'none' ? '房间记录归档' : delivery.workspace?.vcs}`),
          delivery.commit ? h('span', { className: 'crew-muted' }, '未 push') : null),
        delivery.workspacePath
          ? h('div', { className: 'crew-kv' },
            h('span', null, '位置'),
            h('code', { title: delivery.workspacePath }, delivery.workspacePath),
            h('button', { type: 'button', className: 'crew-ghost', onClick: () => void open(delivery.workspacePath) }, '打开'))
          : null,
        delivery.workspacePath && delivery.workspace?.vcs === 'none' && delivery.sourcePath
          ? h('p', { className: 'crew-field-hint' }, `原目录未改：${delivery.sourcePath}`)
          : null,
        openNotice === null ? null : h('p', { className: 'crew-field-hint' }, openNotice),
        openError === null ? null : h('p', { className: 'crew-field-hint' }, openError),
        h('details', { className: 'crew-fold' },
          h('summary', null, '交付明细'),
          delivery.artifacts?.length > 0
            ? h('div', { className: 'crew-delivery-artifacts' },
              h('b', null, `工作区文件 · ${delivery.artifacts.length}`),
              h('ul', null, delivery.artifacts.map(artifact => h('li', { key: artifact.path },
                h('code', { title: artifact.path }, artifact.path.split('/').pop() || artifact.path),
                h('button', { type: 'button', className: 'crew-ghost', onClick: () => void open(artifact.path) }, '打开')))))
            : null,
          h('div', { className: 'crew-delivery-stages' },
            ...(delivery.stages ?? []).map(stage => h('div', { key: stage.index, className: 'crew-delivery-stage' },
              h('div', { className: 'crew-delivery-stage-head' },
                h('b', null, `${stage.index + 1}. ${stage.title}`),
                h('span', { 'data-state': stage.state }, stage.kind === 'deliverable' ? '交付' : '决策')),
              stage.acceptance ? h('div', { className: 'crew-kv' },
                h('span', null, '验收'),
                h('code', null, stage.acceptance)) : null,
              ...stage.commands.flatMap(command => [
                h('div', { key: command.id, className: 'crew-kv' },
                  h('span', null, '命令'),
                  h('code', null, `${command.command} · exit ${command.exit === null ? '无' : command.exit}`)),
                h('div', { key: `${command.id}-digest`, className: 'crew-kv' },
                  h('span', null, 'digest'),
                  h('code', { title: command.digest ?? '' }, short(command.digest) || '缺失')),
              ]),
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
              h('ul', null, delivery.changedFiles.map(file => h('li', { key: file },
                h('code', null, file),
                delivery.workspacePath
                  ? h('button', {
                    type: 'button',
                    className: 'crew-ghost',
                    onClick: () => void open(joinPath(delivery.workspacePath, file)),
                  }, '打开')
                  : null))))
            : null)),
      h('div', { className: 'crew-card-foot' },
        h('span', { className: 'crew-conclusion-signoff' }, signoff),
        onExport === undefined
          ? null
          : h('button', {
            type: 'button',
            className: 'crew-accept crew-conclusion-next',
            onClick: onExport,
          }, '导出交付单'))))
}
