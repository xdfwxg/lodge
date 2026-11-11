import { Fragment, createElement as h, useEffect, useState } from 'react'
import { BotAvatar } from '../marks.js'
import { STAGE_KIND, TASK_LABEL } from './model.js'
import './island.css'

function StageStep({ stage, selected, onSelect }) {
  const note = [
    stage.reworkCount > 0 ? `返工 ${stage.reworkCount} 次` : '',
    stage.partial?.failed?.length > 0 ? `${stage.partial.failed.length} 席未产出` : '',
  ].filter(Boolean).join(' · ')
  return h('button', {
    type: 'button',
    className: 'crew-step-node',
    'data-state': stage.state,
    'data-selected': selected,
    'aria-current': selected ? 'step' : undefined,
    onClick: onSelect,
    title: note === '' ? stage.title : `${stage.title} · ${note}`,
  },
  h('span', { className: 'crew-step-mark' }, stage.state === 'passed' ? '✓' : String(stage.index + 1)),
  h('span', { className: 'crew-step-label' }, stage.title),
  stage.partial?.failed?.length > 0 ? h('span', { className: 'crew-step-partial' }, `×${stage.partial.failed.length}`) : null,
  stage.reworkCount > 0 ? h('span', { className: 'crew-step-rework' }, `↺${stage.reworkCount}`) : null)
}

function IslandStage({ view, stage, onBack }) {
  const brief = view.brief
  const conflict = stage.conflict
  const current = view.stages.findIndex(item => item.state === 'active')
  return h('div', { className: 'crew-island-stage' },
    h('div', { className: 'crew-island-stage-head' },
      h('b', null, `${stage.index + 1} ${stage.title}`),
      h('span', { className: 'crew-island-kind' }, STAGE_KIND[stage.kind] ?? '')),
    stage.dependsOn.length > 0
      ? h('div', { className: 'crew-kv' },
        h('span', null, '依赖'),
        h('span', { className: 'crew-island-soft' }, stage.dependsOn.map(item => `阶段 ${item + 1}`).join('、')))
      : null,
    stage.partialFailedNames.length > 0
      ? h('div', { className: 'crew-island-rework' },
        h('span', null, `部分成功 · ${stage.partialFailedNames.length} 席未产出`),
        h('p', null, stage.partialFailedNames.join('、')))
      : null,
    h('div', { className: 'crew-kv' },
      h('span', null, '做到什么算过'),
      stage.kind === 'deliverable'
        ? h('code', null, stage.acceptance ?? '未写验收命令')
        : h('span', { className: 'crew-island-soft' }, '你点过才算过')),
    conflict !== null
      ? h('div', { className: 'crew-island-rework' },
        h('span', null, '并行合并冲突 · 等你处理'),
        h('p', null, (conflict.files ?? []).join('、') || conflict.branch || '冲突文件未知'))
      : null,
    stage.reworkCount > 0
      ? h('div', { className: 'crew-island-rework' },
        h('span', null, `返工 ${stage.reworkCount} 次 · 验收席位打回`),
        h('div', { className: 'crew-island-rework-list' },
          stage.rework.slice(0, 3).map(item => h('div', { key: item.id, className: 'crew-island-rework-item' },
            h('span', { className: 'crew-island-rework-author' }, item.author),
            h('span', null, item.at === null ? '' : new Date(item.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })),
            h('p', null, item.text)))),
        stage.reworkCount > 3 ? h('p', { className: 'crew-island-soft' }, `还有 ${stage.reworkCount - 3} 次更早的打回，见时间线`) : null)
      : null,
    stage.evidence.length > 0
      ? h('div', { className: 'crew-island-evidence' },
        stage.evidence.map(item => h('a', {
          key: item.id,
          className: 'crew-island-evidence-link',
          href: item.href,
          target: '_blank',
          rel: 'noreferrer',
        }, item.manual ? '证据 · 产物就绪' : `证据 · ${item.command} · exit ${item.exit ?? '—'}`)))
      : null,
    stage.verdict !== null
      ? h('div', {
        className: 'crew-island-verdict',
        'data-pass': stage.verdict.pass,
        'data-pending': stage.verdict.pending === true,
      }, stage.verdict.text || (stage.verdict.pass ? '验收席位已给 PASS' : '验收席位打回，等返工'))
      : null,
    stage.tasks.length > 0
      ? h('div', { className: 'crew-island-tasks' },
        h('span', { className: 'crew-island-soft' }, '任务'),
        stage.tasks.map(task => h('div', { key: task.id, className: 'crew-island-task', 'data-state': task.status },
          task.seat
            ? h(BotAvatar, { bot: task.seat, size: 20, live: task.status === 'working' })
            : h('span', { className: 'crew-island-task-title' }, '·'),
          h('span', { className: 'crew-island-task-title' }, task.title),
          task.evidenceRef
            ? h('a', {
              className: 'crew-island-task-evidence',
              href: `/api/rooms/${view.id}/evidence/${task.evidenceRef}`,
              target: '_blank',
              rel: 'noreferrer',
            }, '证据')
            : null,
          h('span', { className: 'crew-island-task-state' }, TASK_LABEL[task.status] ?? task.status))))
      : null,
    stage.otherSeats.length > 0
      ? h('div', { className: 'crew-island-seats' },
        stage.otherSeats.map(item => h('div', { key: item.seat.id, className: 'crew-island-seat', 'data-state': item.state },
          h(BotAvatar, { bot: item.seat, size: 22, live: item.state === 'working' }),
          h('span', { className: 'crew-island-seat-name' }, item.seat.name),
          h('span', { className: 'crew-island-seat-task' }, item.task),
          h('span', { className: 'crew-island-seat-state' },
            item.state === 'done' ? '已交'
              : item.state === 'working' ? '在做'
                : item.state === 'idle' ? '待命'
                  : item.state === 'paused' ? '暂停'
                    : '未开始'))))
      : null,
    h('details', { className: 'crew-island-checks' },
      h('summary', null, '目标与检查'),
      h('div', { className: 'crew-island-checks-body' },
        h('div', { className: 'crew-kv' }, h('span', null, 'objective'), h('span', null, brief?.objective || view.goal)),
        h('div', { className: 'crew-kv' }, h('span', null, 'done'),
          h('span', { className: 'crew-island-done' },
            (brief?.done ?? view.stages.map(item => ({ done: item.state === 'passed', text: `${item.index + 1} ${item.title}` })))
              .map(item => h('span', { key: item.text, 'data-done': item.done }, `${item.done ? '✓' : '·'} ${item.text}`)))),
        (brief?.constraints ?? []).length > 0
          ? h('div', { className: 'crew-kv' }, h('span', null, 'constraints'),
            h('span', { className: 'crew-island-done' }, brief.constraints.map(text => h('span', { key: text }, `- ${text}`))))
          : null)),
    current >= 0 && stage.index !== current
      ? h('button', { type: 'button', className: 'crew-ghost crew-island-back', onClick: onBack }, '回到当前阶段')
      : null)
}

export function GoalIsland({ view, advanced, actions }) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState(null)
  const [armed, setArmed] = useState(false)
  const current = view.stages.findIndex(stage => stage.state === 'active')
  const selected = picked ?? (current >= 0 ? current : view.stages.length - 1)
  const stage = view.stages[selected]
  const answers = [
    ['目标', view.answers.goal, 'goal'],
    ['进度', view.answers.progress, 'progress'],
    ['怎么算过', stage?.acceptanceLabel ?? '—', 'acceptance'],
  ]

  useEffect(() => {
    setPicked(null)
  }, [current])

  useEffect(() => {
    if (!armed) return undefined
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  return h('header', { className: 'crew-head crew-island', 'data-open': open },
    h('div', {
      className: 'crew-island-top',
      role: 'button',
      tabIndex: 0,
      'aria-expanded': open,
      'aria-controls': 'crew-island-panel',
      onClick: () => setOpen(value => !value),
      onKeyDown: event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setOpen(value => !value)
        }
      },
    },
    h('span', { className: 'crew-island-dot', 'data-tone': view.status.tone }),
    h('h1', { title: view.goal }, view.name),
    ...view.badges.map(badge => h('span', { key: badge.label, className: 'crew-badge', 'data-warn': badge.warn === true }, badge.label)),
    h('span', { className: 'crew-island-pill' },
      `${view.progress.value}/${view.progress.total}`,
      h('span', { className: 'crew-island-chev', 'data-open': open }, '⌄'))),
    h('div', { className: 'crew-island-strip' },
      h('span', { className: 'crew-island-state', 'data-tone': view.status.tone }, view.status.label),
      h('div', { className: 'crew-island-track' }, view.track.map((tone, index) => h('i', { key: index, 'data-tone': tone }))),
      view.faces.length > 0
        ? h('div', { className: 'crew-island-faces' },
          view.faces.slice(0, 4).map(face => h(BotAvatar, { key: face.seat.id, bot: face.seat, size: 20, live: face.live })),
          view.faces.length > 4 ? h('span', { className: 'crew-island-more' }, `+${view.faces.length - 4}`) : null)
        : null),
    open
      ? h('div', { id: 'crew-island-panel', className: 'crew-island-panel', role: 'region', 'aria-label': '目标与阶段' },
        h('div', { className: 'crew-island-answers' },
          answers.map(([label, value, kind]) => h('div', { key: label, className: 'crew-island-answer', 'data-kind': kind },
            h('span', null, label),
            h('b', { title: value }, value)))),
        h('div', { className: 'crew-island-steps' },
          view.stages.map(item => h(StageStep, {
            key: item.index,
            stage: item,
            selected: item.index === selected,
            onSelect: () => setPicked(item.index),
          }))),
        stage === undefined ? null : h(IslandStage, { view, stage, onBack: () => setPicked(current >= 0 ? current : null) }),
        h('div', { className: 'crew-island-foot' },
          h('button', { type: 'button', className: 'crew-ghost', onClick: actions.review }, '复盘'),
          h('button', { type: 'button', className: 'crew-ghost', onClick: actions.toggleAdvanced }, advanced ? '收起高级' : '高级'),
          h('span', { className: 'crew-island-foot-space' }),
          view.controls.canContinue && actions.continue !== undefined
            ? h('button', { type: 'button', className: 'crew-choice', onClick: actions.continue }, '基于此记录续做')
            : null,
          view.controls.imported ? h('span', { className: 'crew-ghost' }, '只读记录') : null,
          view.controls.canPause ? h('button', { type: 'button', className: 'crew-ghost', onClick: actions.pause }, '暂停') : null,
          view.controls.canResume ? h('button', { type: 'button', className: 'crew-ghost', onClick: actions.resume }, '继续') : null,
          view.controls.canStop
            ? h('button', {
              type: 'button',
              className: 'crew-ghost',
              'data-armed': armed,
              onClick: () => {
                if (armed) {
                  setArmed(false)
                  actions.stop()
                } else {
                  setArmed(true)
                }
              },
            }, armed ? '再点一次确认停止' : '停止')
            : null))
      : null)
}
