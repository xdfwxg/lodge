import { createElement as h, useEffect, useState } from 'react'
import { Markdown } from '../../message-cards.js'
import { openPath as openTarget } from '../../system.js'
import { dateTimeOf } from '../../view-format.js'
import { errorSuffix } from '../../error-text.js'
import { artifactKindOf } from '../../../../shared/artifact.js'
import {
  CADENCE_LABELS,
  clockOf,
  momentLabelOf,
  parseClock,
  routineNextLabel,
  scheduleLabelOf,
} from '../../../../shared/routine.js'

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

export function DeliveryPreview({ kind, content, image, alt }) {
  if (image !== null) {
    return h('div', { className: 'studio-delivery-preview studio-delivery-preview-image' },
      h('img', { className: 'studio-delivery-image', src: image, alt }))
  }
  if (content === '') return null
  return h('div', { className: 'studio-delivery-preview' },
    kind === 'document'
      ? h(Markdown, { text: content })
      : h('pre', { className: 'crew-code studio-delivery-text' }, content))
}

// 交付是房间的最后一次发言：外壳与聊天结论卡一致，完整明细收在卡内。
export function DeliveryCard({ delivery: goalDelivery, onContinue = null, onReturn = null, onDownload = null, onRead = null, onRoutine = null, onOpenRun = null, latestRun = null, runs = [] }) {
  const latestDelivery = latestRun?.delivery ?? null
  const hasLatest = latestDelivery !== null
  const [showOriginal, setShowOriginal] = useState(false)
  const showingOriginal = hasLatest && showOriginal
  const delivery = showingOriginal || !hasLatest
    ? goalDelivery
    : {
        ...latestDelivery,
        name: goalDelivery.name,
        goal: goalDelivery.goal,
        routine: goalDelivery.routine,
        routineManual: goalDelivery.routineManual,
        sample: goalDelivery.sample,
        archived: goalDelivery.archived,
      }
  const commands = delivery.commands ?? []
  const manualNotes = (delivery.stages ?? [])
    .map(stage => stage.manual?.text?.trim() ?? '')
    .filter(Boolean)
  const waitingNote = /^(结果已经好了|并行结果已合并)/
  const meaningfulNote = manualNotes.find(note => !waitingNote.test(note)) ?? ''
  const manualVerdict = (delivery.stages ?? [])
    .flatMap(stage => stage.verdicts ?? [])
    .filter(verdict => verdict.pass === true && typeof verdict.text === 'string' && verdict.text.trim() !== '')
    .slice(-1)[0] ?? null
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
      setOpenError(`没能打开${errorSuffix(error)}`)
    }
  }
  const goalText = typeof delivery.goal === 'string' ? delivery.goal.replace(/\*\*/g, '').trim() : ''
  const goalFirst = goalText.split('\n').map(line => line.trim()).find(line => line !== '') ?? ''
  const nameText = typeof delivery.name === 'string' ? delivery.name.trim() : ''
  const kindOf = artifact => artifact?.kind ?? artifactKindOf(artifact?.path)
  const artifactPaths = new Set((delivery.artifacts ?? []).map(artifact => artifact.relativePath ?? artifact.path))
  const changedFiles = delivery.changedFiles ?? []
  const otherChangedFiles = changedFiles.filter(file => !artifactPaths.has(file))
  const fileCount = new Set([...artifactPaths, ...changedFiles]).size
  const usage = delivery.usage ?? null
  const micro = usage?.costMicroUsd ?? 0
  const money = micro >= 10_000 ? `$${(micro / 1_000_000).toFixed(2)}` : `$${(micro / 1_000_000).toFixed(4)}`
  const cost = usage === null
    ? ''
    : usage.costStatus === 'unknown'
      ? '费用未知'
      : usage.costStatus === 'partial' ? `至少 ${money}` : money
  const metrics = fileCount > 0 ? `${fileCount} 个文件` : ''
  const signoff = delivery.independenceLabel ?? ''
  const routine = delivery.routine ?? null
  const patchRoutine = patch => onRoutine?.({
    enabled: routine?.enabled === true,
    cadence: routine?.cadence ?? 'daily',
    hour: routine?.hour ?? 8,
    minute: routine?.minute ?? 0,
    ...patch,
  })
  const [editing, setEditing] = useState(false)
  const [draftCadence, setDraftCadence] = useState(routine?.cadence ?? 'daily')
  const [draftHour, setDraftHour] = useState(routine?.hour ?? 8)
  const [draftMinute, setDraftMinute] = useState(routine?.minute ?? 0)
  useEffect(() => {
    if (routine === null) return
    setDraftCadence(routine.cadence)
    setDraftHour(routine.hour)
    setDraftMinute(routine.minute)
  }, [routine?.cadence, routine?.hour, routine?.minute])
  const draftOf = () => ({ cadence: draftCadence, hour: draftHour, minute: draftMinute })
  const startRoutine = () => {
    patchRoutine({ enabled: true, ...draftOf() })
    setEditing(false)
  }
  const cancelEdit = () => {
    setDraftCadence(routine?.cadence ?? 'daily')
    setDraftHour(routine?.hour ?? 8)
    setDraftMinute(routine?.minute ?? 0)
    setEditing(false)
  }
  const scheduled = routine === null ? '' : scheduleLabelOf(routine)
  const timeValue = clockOf(draftHour, draftMinute).padStart(5, '0')
  const pastRuns = routine === null
    ? []
    : runs.filter(run => run.id !== latestRun?.id)
  const historyEntries = []
  if (hasLatest) {
    historyEntries.push(h('button', {
      key: showingOriginal ? 'latest-result' : 'original-result',
      type: 'button',
      className: 'crew-link',
      onClick: () => setShowOriginal(!showingOriginal),
    }, showingOriginal ? '最新一次' : '最初那次'))
  }
  if (onOpenRun !== null) {
    for (const run of [...pastRuns].reverse()) {
      historyEntries.push(h('button', {
        key: run.id,
        type: 'button',
        className: 'crew-link',
        onClick: () => onOpenRun(run.id),
      }, run.name ?? run.id))
    }
  }
  const historyNode = historyEntries.length === 0 ? null : h('details', {
    className: 'crew-fold crew-routine-history',
  },
  h('summary', null, `往次 ${historyEntries.length} 次`),
  h('div', { className: 'crew-routine-runs' }, historyEntries))
  const artifacts = delivery.artifacts ?? []
  const primaryArtifact = artifacts.find(artifact => kindOf(artifact) !== 'file') ?? artifacts[0] ?? null
  const primaryKind = primaryArtifact === null ? null : kindOf(primaryArtifact)
  const embeddedContent = typeof primaryArtifact?.content === 'string' ? primaryArtifact.content : ''
  const [loaded, setLoaded] = useState(null)
  useEffect(() => {
    if (primaryArtifact === null || primaryKind === 'file' || embeddedContent !== '' || typeof onRead !== 'function') {
      return undefined
    }
    let active = true
    void Promise.resolve(onRead(delivery.roomId, primaryArtifact.path))
      .then(result => {
        if (active && (typeof result?.text === 'string' || typeof result?.base64 === 'string')) setLoaded(result)
      })
      .catch(() => {})
    return () => { active = false }
  }, [delivery.roomId, primaryArtifact?.path, primaryKind, embeddedContent, onRead])
  const primaryContent = primaryKind === 'document' || primaryKind === 'text'
    ? (embeddedContent !== '' ? embeddedContent : (loaded?.text ?? ''))
    : ''
  const primaryImage = primaryKind === 'image' && typeof loaded?.base64 === 'string' && loaded.base64 !== ''
    ? `data:${loaded.mime ?? 'application/octet-stream'};base64,${loaded.base64}`
    : null
  const hasPreview = primaryContent !== '' || primaryImage !== null
  const primaryTarget = primaryArtifact === null
    ? null
    : isAbsolutePath(primaryArtifact.path)
      ? primaryArtifact.path
      : delivery.workspacePath ? joinPath(delivery.workspacePath, primaryArtifact.path) : null
  const showProof = commands.length > 0 || manualVerdict !== null || !hasPreview
  const routineNode = onRoutine === null || delivery.sample === true ? null : (() => {
    if (delivery.archived === true) {
      return routine === null
        ? null
        : h('div', { className: 'crew-routine' },
          h('p', { className: 'crew-field-hint' }, '已归档。取消归档后可以再开。'),
          historyNode)
    }
    if (routine !== null && routine.paused === true) {
      const again = () => patchRoutine({
        enabled: true,
        cadence: routine.cadence,
        hour: routine.hour,
        minute: routine.minute,
      })
      return h('div', { className: 'crew-routine', 'data-paused': 'true' },
        h('p', { className: 'crew-routine-lead' }, '连续 3 次没做成，已经停下。'),
        h('div', { className: 'crew-routine-actions' },
          h('button', { type: 'button', className: 'crew-link', onClick: again }, '再试一次'),
          h('button', {
            type: 'button',
            className: 'crew-link',
            onClick: () => patchRoutine({ enabled: false }),
          }, '关掉')),
        historyNode)
    }
    const controls = action => h('div', { className: 'crew-routine-line' },
      h('span', { className: 'crew-routine-prefix' }, '以后'),
      h('select', {
        className: 'crew-routine-cadence',
        value: draftCadence,
        'aria-label': '多久做一次',
        onChange: event => setDraftCadence(event.target.value),
      }, Object.entries(CADENCE_LABELS).map(([value, label]) => h('option', { key: value, value }, label))),
      h('input', {
        className: 'crew-routine-time',
        type: 'time',
        value: timeValue,
        'aria-label': '几点做',
        onChange: event => {
          const clock = parseClock(event.target.value)
          if (clock !== null) {
            setDraftHour(clock.hour)
            setDraftMinute(clock.minute)
          }
        },
      }),
      h('span', { className: 'crew-routine-suffix' }, '再做一遍'),
      action)
    if (routine === null || routine.enabled !== true) {
      return h('div', { className: 'crew-routine' },
        controls(h('button', {
          type: 'button',
          className: 'crew-routine-start',
          onClick: startRoutine,
        }, '开始')),
        h('p', { className: 'crew-field-hint' }, 'Lodge 没开时，下次打开补一次。'),
        historyNode)
    }
    if (editing) {
      return h('div', { className: 'crew-routine', 'data-on': 'true' },
        controls(h('span', { className: 'crew-routine-actions' },
          h('button', { type: 'button', className: 'crew-routine-start', onClick: startRoutine }, '好'),
          h('button', { type: 'button', className: 'crew-link', onClick: cancelEdit }, '取消'))),
        delivery.routineManual === true
          ? h('p', { className: 'crew-field-hint' }, '每次跑完要你看一眼。')
          : null,
        historyNode)
    }
    return h('div', { className: 'crew-routine', 'data-on': 'true' },
      h('div', { className: 'crew-routine-line' },
        h('button', {
          type: 'button',
          className: 'crew-routine-schedule',
          title: '改时间',
          'aria-label': `改时间，现在是${scheduled}`,
          onClick: () => setEditing(true),
        }, scheduled),
        routine.nextRunAt === null
          ? null
          : h('span', { className: 'crew-routine-next' }, `· 下次 ${routineNextLabel(routine.nextRunAt)}`),
        h('button', {
          type: 'button',
          className: 'crew-link',
          onClick: () => patchRoutine({ enabled: false }),
        }, '关掉')),
      delivery.routineManual === true
        ? h('p', { className: 'crew-field-hint' }, '每次跑完要你看一眼。')
        : null,
      routine.skippedAt === null
        ? null
        : h('p', { className: 'crew-field-hint' }, '上一次还没结束，这次先没跑。'),
      historyNode)
  })()
  return h('div', { className: 'crew-msg-conclusion', 'data-outcome': 'delivery' },
    h('div', { className: 'crew-card crew-conclusion', 'data-settled': 'true', 'aria-label': '结果' },
      h('div', { className: 'crew-card-body' },
        h('div', { className: 'studio-delivery-head' },
          h('span', { className: 'studio-delivery-kicker' },
            hasLatest ? (showingOriginal ? '最初那次' : '最新一次') : '结果'),
          Number.isFinite(delivery.completedAt)
            ? h('span', { className: 'studio-delivery-at' }, momentLabelOf(delivery.completedAt))
            : null,
          showingOriginal
            ? h('button', {
              type: 'button',
              className: 'crew-link',
              onClick: () => setShowOriginal(false),
            }, '回到最新')
            : null,
          delivery.sample === true ? h('span', { className: 'studio-delivery-sample' }, '示例') : null),
        h('h3', { className: 'studio-delivery-name' }, nameText === '' ? '这次做出来的' : nameText),
        goalFirst === '' || goalFirst === nameText ? null : h('p', { className: 'studio-delivery-goal' }, goalFirst),
        goalText !== goalFirst
          ? h('details', { className: 'crew-fold' },
            h('summary', null, '完整目标'),
            h('p', { className: 'crew-field-hint' }, goalText))
          : null,
        showProof
          ? h('div', { className: 'studio-delivery-proof', role: 'group', 'aria-label': '检查' },
            commands.length > 0
              ? h('p', {
                className: 'studio-delivery-proof-summary',
                'data-pass': commands.every(command => command.exit === 0),
              }, commands.every(command => command.exit === 0)
                ? `${commands.length} 项检查通过`
                : '有检查没通过')
              : manualVerdict !== null
                ? h('p', { className: 'crew-field-hint' }, `验收：${manualVerdict.text}`)
                : h('span', { className: 'crew-field-hint' }, meaningfulNote !== ''
                  ? meaningfulNote
                  : primaryArtifact !== null
                    ? `结果在 ${primaryArtifact.relativePath ?? primaryArtifact.path}。`
                    : manualNotes[0] ?? '人工验收'))
          : null,
        metrics === '' || hasPreview ? null : h('p', { className: 'crew-delivery-metrics' }, metrics),
        hasPreview
          ? h(DeliveryPreview, {
            kind: primaryKind,
            content: primaryContent,
            image: primaryImage,
            alt: primaryArtifact.relativePath ?? primaryArtifact.path,
          })
          : primaryArtifact !== null
            ? h('div', { className: 'studio-delivery-file' },
              h('span', { className: 'studio-delivery-file-icon' }, h(FileIcon)),
              h('code', { title: primaryArtifact.relativePath ?? primaryArtifact.path }, primaryArtifact.relativePath ?? primaryArtifact.path),
              primaryTarget === null
                ? null
                : h('button', {
                  type: 'button',
                  className: 'crew-link',
                  onClick: () => void open(primaryTarget),
                }, '打开'))
            : null,
        delivery.workspacePath
          ? h('div', { className: 'studio-delivery-open' },
            h('button', {
              type: 'button',
              className: 'crew-link',
              onClick: () => void open(delivery.workspacePath),
            }, '在文件夹打开'))
          : null,
        openNotice === null ? null : h('p', { className: 'crew-field-hint', role: 'status' }, openNotice),
        openError === null ? null : h('p', { className: 'crew-field-hint', role: 'alert' }, openError),
        routineNode,
        h('details', {
          className: 'crew-fold studio-delivery-details',
          open: detailsOpen || undefined,
          onToggle: event => setDetailsOpen(event.currentTarget.open),
        },
          h('summary', null, '详情'),
          delivery.completedAt || delivery.commit || cost !== '' || delivery.workspacePath || signoff !== ''
            ? h('div', { className: 'studio-delivery-detail-meta' },
              delivery.completedAt
                ? h('div', { className: 'crew-kv' }, h('span', null, '完成时间'), h('span', null, dateTimeOf(delivery.completedAt)))
                : null,
              delivery.commit
                ? h('div', { className: 'crew-kv' }, h('span', null, '版本'), h('code', null, short(delivery.commit)))
                : null,
              cost === ''
                ? null
                : h('div', { className: 'crew-kv' }, h('span', null, '费用'), h('span', null, cost)),
              delivery.workspacePath
                ? h('div', { className: 'studio-delivery-row' },
                  h('span', { className: 'studio-delivery-label' }, '位置'),
                  h('code', { title: delivery.workspacePath }, delivery.workspacePath))
                : null,
              delivery.workspacePath && delivery.workspace?.vcs === 'none' && delivery.sourcePath
                ? h('div', { className: 'crew-kv' }, h('span', null, '原目录'), h('code', null, delivery.sourcePath))
                : null,
              signoff === ''
                ? null
                : h('div', { className: 'crew-kv' }, h('span', null, '对比方式'), h('span', null, signoff)))
            : null,
          commands.length > 0
            ? h('div', { className: 'crew-delivery-checks' },
              h('div', { className: 'studio-delivery-file-head' },
                h('b', null, '检查'),
                h('span', null, commands.length)),
              h('ul', null, commands.map(command => h('li', { key: command.id },
                h('code', null, `${command.command || '检查命令'} · 退出码 ${command.exit === null || command.exit === undefined ? '无' : command.exit}`),
                h('b', { 'data-pass': command.exit === 0 }, command.exit === 0 ? '通过' : '没通过'),
                command.simulated === true && delivery.sample !== true
                  ? h('span', { className: 'studio-delivery-check-note' }, '示例运行')
                  : null))))
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
            : null,
          onDownload === null
            ? null
            : h('div', { className: 'crew-delivery-download' },
              h('button', { type: 'button', className: 'crew-link', onClick: onDownload }, '下载交付记录')))),
      onReturn === null && onContinue === null
        ? null
        : h('div', { className: 'crew-card-foot' },
          onReturn === null
            ? null
            : h('button', {
              type: 'button',
              className: 'crew-ghost',
              onClick: onReturn,
            }, '回聊天室'),
          onContinue === null
            ? null
            : h('button', {
              type: 'button',
              className: 'crew-accept crew-conclusion-next crew-quiet-primary',
              onClick: onContinue,
            }, '继续做'))))
}
