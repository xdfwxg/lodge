import { createElement as h, useState } from 'react'
import { openPath as openTarget } from '../../system.js'
import { dateTimeOf } from '../../view-format.js'

const short = hash => (typeof hash === 'string' && hash.length > 12 ? hash.slice(0, 12) : hash)
const isAbsolutePath = value => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
const joinPath = (base, file) => isAbsolutePath(file) ? file : `${base.replace(/\/$/, '')}/${file}`

const FileIcon = () => h('svg', {
  width: 14,
  height: 14,
  viewBox: '0 0 20 20',
  fill: 'none',
  'aria-hidden': 'true',
},
h('path', {
  d: 'M6 2.75h5l3 3v11.5H6z',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinejoin: 'round',
}),
h('path', {
  d: 'M11 2.75v3h3',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinejoin: 'round',
}))

// 交付是房间的最后一次发言：外壳与聊天结论卡一致，完整明细收在卡内。
export function DeliveryCard({ delivery, onContinue = null, onReturn = null }) {
  const commands = delivery.commands ?? []
  const manualNotes = (delivery.stages ?? [])
    .map(stage => stage.manual?.text?.trim() ?? '')
    .filter(Boolean)
  const [openError, setOpenError] = useState(null)
  const [openNotice, setOpenNotice] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const open = async target => {
    try {
      setOpenError(null)
      await openTarget(target)
      setOpenNotice('已打开')
      setTimeout(() => setOpenNotice(null), 2000)
    } catch (error) {
      setOpenError(`没能打开：${String(error?.message ?? error)}`)
    }
  }
  const goalText = typeof delivery.goal === 'string' ? delivery.goal.replace(/\*\*/g, '').trim() : ''
  const goalFirst = goalText.split('\n').map(line => line.trim()).find(line => line !== '') ?? ''
  const nameText = typeof delivery.name === 'string' ? delivery.name.trim() : ''
  const stepTotal = delivery.stages?.length ?? 0
  const artifactPaths = new Set((delivery.artifacts ?? []).map(artifact => artifact.relativePath ?? artifact.path))
  const changedFiles = delivery.changedFiles ?? []
  const otherChangedFiles = changedFiles.filter(file => !artifactPaths.has(file))
  const fileCount = new Set([...artifactPaths, ...changedFiles]).size
  const metrics = [
    stepTotal > 0 ? `${stepTotal} 步` : '',
    commands.length > 0 ? `${commands.length} 项检查` : '',
    fileCount > 0 ? `${fileCount} 个文件` : '',
  ].filter(Boolean).join(' · ')
  const signoff = delivery.independenceLabel ?? ''
  return h('div', { className: 'crew-msg-conclusion', 'data-outcome': 'delivery' },
    h('div', { className: 'crew-card crew-conclusion', 'data-settled': 'true', 'aria-label': '结果' },
      h('div', { className: 'crew-card-body' },
        h('div', { className: 'studio-delivery-head' },
          h('span', { className: 'studio-delivery-kicker' }, '结果'),
          delivery.sample === true ? h('span', { className: 'studio-delivery-sample' }, '示例') : null,
          h('span', { className: 'studio-delivery-chip' },
            h('span', { className: 'studio-delivery-check-icon', 'aria-hidden': 'true' }, '✓'),
            '已完成')),
        h('h3', { className: 'studio-delivery-name' }, nameText === '' ? '这次做出来的' : nameText),
        goalFirst === '' || goalFirst === nameText ? null : h('p', { className: 'studio-delivery-goal' }, goalFirst),
        goalText !== goalFirst
          ? h('details', { className: 'crew-fold' },
            h('summary', null, '完整目标'),
            h('p', { className: 'crew-field-hint' }, goalText))
          : null,
        h('div', { className: 'studio-delivery-proof', role: 'group', 'aria-label': '检查' },
          commands.length > 0
            ? commands.map(command => h('div', {
              key: command.id,
              className: 'studio-delivery-check',
              title: `退出码 ${command.exit === null ? '无' : command.exit}`,
            },
            h('code', null, command.command || '检查命令'),
            command.simulated === true && delivery.sample !== true
              ? h('span', { className: 'studio-delivery-check-note' }, '示例运行')
              : null,
            h('span', { 'data-pass': command.exit === 0 }, command.exit === 0 ? '通过' : '没通过'),
            h('span', { className: 'visually-hidden' }, `退出码 ${command.exit === null || command.exit === undefined ? '无' : command.exit}`)))
            : h('span', { className: 'crew-field-hint' }, manualNotes[0] ?? '人工验收')),
        metrics === '' ? null : h('p', { className: 'crew-delivery-metrics' }, metrics),
        h('div', { className: 'studio-delivery-meta' },
          delivery.workspacePath
            ? h('div', { className: 'studio-delivery-row' },
              h('span', { className: 'studio-delivery-label' }, '位置'),
              h('code', { title: delivery.workspacePath }, delivery.workspacePath),
              h('button', {
                type: 'button',
                className: 'crew-ghost',
                'aria-label': '打开结果文件夹',
                onClick: () => void open(delivery.workspacePath),
              }, '打开'))
            : null),
        delivery.workspacePath && delivery.workspace?.vcs === 'none' && delivery.sourcePath
          ? h('p', { className: 'crew-field-hint' }, `原目录未改：${delivery.sourcePath}`)
          : null,
        openNotice === null ? null : h('p', { className: 'crew-field-hint', role: 'status' }, openNotice),
        openError === null ? null : h('p', { className: 'crew-field-hint', role: 'alert' }, openError),
        h('details', {
          className: 'crew-fold studio-delivery-details',
          open: detailsOpen || undefined,
          onToggle: event => setDetailsOpen(event.currentTarget.open),
        },
          h('summary', null, '详情'),
          delivery.completedAt || delivery.commit
            ? h('div', { className: 'studio-delivery-detail-meta' },
              delivery.completedAt
                ? h('div', { className: 'crew-kv' }, h('span', null, '完成时间'), h('span', null, dateTimeOf(delivery.completedAt)))
                : null,
              delivery.commit
                ? h('div', { className: 'crew-kv' }, h('span', null, '版本'), h('code', null, short(delivery.commit)))
                : null)
            : null,
          delivery.artifacts?.length > 0
            ? h('div', { className: 'crew-delivery-artifacts' },
              h('div', { className: 'studio-delivery-file-head' },
                h('b', null, '文件'),
                h('span', null, delivery.artifacts.length)),
              h('ul', null, delivery.artifacts.map(artifact => {
                const content = typeof artifact.content === 'string' && artifact.content !== '' ? artifact.content : null
                const target = isAbsolutePath(artifact.path)
                  ? artifact.path
                  : delivery.workspacePath
                    ? joinPath(delivery.workspacePath, artifact.path)
                    : null
                return h('li', { key: artifact.path },
                  h('span', { className: 'studio-delivery-file-icon' }, h(FileIcon)),
                  h('code', { title: artifact.path }, artifact.path.split('/').pop() || artifact.path),
                  content !== null
                    ? h('details', { className: 'crew-fold studio-delivery-file-view' },
                      h('summary', { 'aria-label': `查看 ${artifact.path}` }, '查看'),
                      h('pre', { className: 'crew-code' }, content))
                    : target === null
                      ? null
                      : h('button', {
                        type: 'button',
                        className: 'crew-ghost',
                        'aria-label': `打开 ${artifact.path}`,
                        onClick: () => void open(target),
                      }, '打开'))
              })))
            : null,
          h('div', { className: 'crew-delivery-stages' },
            ...(delivery.stages ?? []).map(stage => h('div', { key: stage.index, className: 'crew-delivery-stage' },
              h('div', { className: 'crew-delivery-stage-head' },
                h('span', { className: 'crew-delivery-stage-index' }, stage.index + 1),
                h('b', null, stage.title),
                h('span', { className: 'crew-delivery-stage-kind' }, stage.kind === 'deliverable' ? '已交付' : '已确认')),
              h('div', { className: 'crew-delivery-stage-body' },
                ...stage.commands.map(command => h('div', { key: command.id, className: 'crew-delivery-fact crew-delivery-fact-command-row' },
                  h('span', null, '检查'),
                  h('code', { className: 'crew-delivery-fact-command' }, command.command || '检查命令'),
                  h('b', { 'data-pass': command.exit === 0 }, command.exit === 0 ? '通过' : '没通过'))),
                ...stage.verdicts.map(verdict => h('div', { key: verdict.id, className: 'crew-delivery-fact' },
                  h('span', null, '复核'),
                  h('span', null, delivery.memberNames?.[verdict.authorId] ?? verdict.authorId),
                  h('b', { 'data-pass': verdict.pass }, verdict.pass ? '通过' : '退回'))),
                stage.acceptance || stage.commands.length > 0
                  ? h('details', { className: 'crew-fold' },
                    h('summary', null, '技术细节'),
                    stage.acceptance ? h('div', { className: 'crew-kv' },
                      h('span', null, '检查'),
                      h('code', null, stage.acceptance)) : null,
                    ...stage.commands.map(command => h('div', { key: `${command.id}-tech`, className: 'crew-kv' },
                      h('span', null, '命令'),
                      h('code', null, `${command.command} · 退出码 ${command.exit === null ? '无' : command.exit}`))))
                  : null,
                stage.changedFiles?.length
                  ? h('details', { className: 'crew-fold' },
                    h('summary', null, `改动文件 ${stage.changedFiles.length}`),
                    h('ul', null, stage.changedFiles.map(file => h('li', { key: file }, h('code', null, file)))))
                  : null)))),
          otherChangedFiles.length > 0
            ? h('details', { className: 'crew-fold crew-delivery-files' },
              h('summary', null, `${artifactPaths.size > 0 ? '其他改动' : '改动文件'} · ${otherChangedFiles.length}`),
              h('ul', null, otherChangedFiles.map(file => h('li', { key: file },
                h('code', null, file),
                delivery.workspacePath
                  ? h('button', {
                    type: 'button',
                    className: 'crew-ghost',
                    'aria-label': `打开 ${file}`,
                    onClick: () => void open(joinPath(delivery.workspacePath, file)),
                  }, '打开')
                  : null))))
            : null)),
      h('div', { className: 'crew-card-foot' },
        h('span', { className: 'crew-conclusion-signoff' }, signoff),
        onContinue === null
          ? null
          : h('button', {
            type: 'button',
            className: 'crew-accept crew-conclusion-next',
            onClick: onContinue,
          }, '继续做'),
        onReturn === null
          ? null
          : h('button', {
            type: 'button',
            className: 'crew-ghost',
            onClick: onReturn,
          }, '回聊天室'))))
}
