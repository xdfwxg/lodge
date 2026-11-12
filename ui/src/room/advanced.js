import { createElement as h, useEffect, useState } from 'react'
import { money, countOf, timeOf, workspaceOf, seatPermissionOf } from '../view-format.js'

function StageEditRow({ stage, index, store }) {
  const [title, setTitle] = useState(stage.title)
  const [kind, setKind] = useState(stage.kind)
  const [acceptance, setAcceptance] = useState(stage.acceptance ?? '')
  return h('div', { className: 'crew-stage-edit-row' },
    h('input', {
      className: 'crew-goal-input',
      type: 'text',
      value: title,
      onChange: event => setTitle(event.target.value),
    }),
    h('select', {
      value: kind,
      onChange: event => setKind(event.target.value),
    },
    h('option', { value: 'deliverable' }, '交付'),
    h('option', { value: 'decision' }, '决策')),
    kind === 'deliverable'
      ? h('input', {
        className: 'crew-goal-input',
        type: 'text',
        value: acceptance,
        placeholder: '验收命令',
        onChange: event => setAcceptance(event.target.value),
      })
      : h('span', { className: 'crew-muted' }, '你拍板'),
    h('button', {
      type: 'button',
      className: 'crew-choice',
      onClick: () => void store.editStagePlan('update', index, {
        title,
        kind,
        ...(kind === 'deliverable' ? { acceptance } : {}),
        dependsOn: stage.dependsOn ?? [],
      }),
    }, '保存'),
    h('button', {
      type: 'button',
      className: 'crew-ghost',
      onClick: () => void store.editStagePlan('move', index, { to: index - 1 }),
    }, '↑'),
    h('button', {
      type: 'button',
      className: 'crew-ghost',
      onClick: () => void store.editStagePlan('move', index, { to: index + 1 }),
    }, '↓'),
    h('button', {
      type: 'button',
      className: 'crew-ghost',
      onClick: () => void store.editStagePlan('remove', index, {}),
    }, '移除'))
}

function Advanced({ room, seats, store, engines = [] }) {
  const cost = room.usage?.costMicroUsd ?? 0
  const budget = room.usage?.budgetMicroUsd ?? 0
  const percent = budget === 0 ? 0 : Math.min(100, Math.round((cost / budget) * 100))
  const availableEngines = engines.filter(item => item.available)
  const [budgetDraft, setBudgetDraft] = useState(String(budget / 1_000_000))
  const [stageTitle, setStageTitle] = useState('')
  const [stageKind, setStageKind] = useState('deliverable')
  const [stageAcceptance, setStageAcceptance] = useState('')
  useEffect(() => {
    setBudgetDraft(String(budget / 1_000_000))
  }, [room.id, budget])
  const saveBudget = () => {
    const value = Number(budgetDraft)
    if (!Number.isFinite(value) || value < 0) return
    void store.setBudget(value)
  }
  const editableStages = (room.stages ?? [])
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage }) => stage.state === 'pending' && stage.title !== '验收与结论')
  return h('div', { className: 'crew-adv' },
    h('div', { className: 'crew-adv-meta' },
      h('span', null, `房间策略：${room.independencePolicy ?? '未标注'}`),
      h('span', null, `工作区：${workspaceOf(room)}`),
      h('span', null, `可用引擎：${availableEngines.length === 0 ? '无' : availableEngines.map(item => `${item.name}${item.models?.default ? `（${item.models.default}）` : ''}`).join('、')}`),
      ...Object.entries(room.engineFallbacks ?? {}).map(([seat, item]) => (
        h('span', { key: `engine-${seat}` }, `${seat}：${item.requested} → ${item.actual}（${item.reason}）`)
      )),
      ...Object.entries(room.mcpBreakers ?? {})
        .filter(([, breaker]) => breaker?.trippedAt !== null && breaker?.trippedAt !== undefined)
        .map(([server, breaker]) => h('span', { key: `mcp-${server}` },
          `MCP 熔断：${server}（${breaker.failures} 次）`,
          h('button', { type: 'button', className: 'crew-ghost', onClick: () => void store.resetMcp(server) }, '恢复'))),
      h('span', null, '预算按基座上报用量估算，不是账单'),
      room.repoPath ? h('span', null, `仓库：${room.repoPath}`) : null,
      room.sourceRepo ? h('span', null, `源仓库：${room.sourceRepo}`) : null,
      ...(room.seatSpecs ?? []).map(seat => (
        room.worktrees?.[seat.id]
          ? h('span', { key: seat.id }, `${seat.name} 工作区：${room.worktrees[seat.id]}${room.prunedSeats?.includes(seat.id) ? '（已清理）' : ''}`)
          : null
      )),
      room.branch ? h('span', null, `房间分支：${room.branch}`) : null,
      room.workers?.length > 1 ? h('span', null, `并行执行：${room.workers.length} 个执行 worktree，合并后复核`) : null,
      h('span', null, `已完成回合：${room.usage?.turns ?? 0}`),
      h('span', null, `修订：${room.revision ?? room.version ?? 1}`),
      ...(room.pastGoals ?? []).map((goal, index) => h('span', { key: `past-${index}` },
        `历史目标：${goal.goal}（${goal.stages?.length ?? 0} 阶段 · ${new Date(goal.completedAt).toLocaleDateString('zh-CN')}）`)),
      h('span', null, `轮次：${room.round ?? 0}`),
      h('span', null, `连续无产出：${room.noProgress ?? 0}`),
      h('span', null, `游标：${(room.seatSpecs ?? []).map(seat => `${seat.name} ${room.seatCursors?.[seat.id] ?? 0}`).join(' · ')} / ${room.messages?.at(-1)?.seq ?? 0}`)),
    h('div', { className: 'crew-budget' },
      h('span', null, '预算'),
      h('div', { className: 'crew-bar' }, h('i', { style: { width: `${percent}%` } })),
      h('b', null, budget === 0 ? `${money(cost)} / 不限` : `${money(cost)} / ${money(budget)}`)),
    h('div', { className: 'crew-budget-edit' },
      h('span', null, '房间预算（美元，0 为不限）'),
      h('input', {
        type: 'number',
        min: 0,
        step: 1,
        value: budgetDraft,
        onChange: event => setBudgetDraft(event.target.value),
      }),
      h('button', { type: 'button', className: 'crew-choice', onClick: saveBudget }, '保存')),
    room.demo === true
      ? null
      : h('div', { className: 'crew-stage-editor' },
        h('span', null, '阶段编辑 · 只改未开始阶段'),
        editableStages.map(({ stage, index }) => h(StageEditRow, { key: index, stage, index, store })),
        h('div', { className: 'crew-stage-edit-row' },
          h('input', {
            className: 'crew-goal-input',
            type: 'text',
            value: stageTitle,
            placeholder: '新阶段标题',
            onChange: event => setStageTitle(event.target.value),
          }),
          h('select', {
            value: stageKind,
            onChange: event => setStageKind(event.target.value),
          },
          h('option', { value: 'deliverable' }, '交付'),
          h('option', { value: 'decision' }, '决策')),
          stageKind === 'deliverable'
            ? h('input', {
              className: 'crew-goal-input',
              type: 'text',
              value: stageAcceptance,
              placeholder: '验收命令',
              onChange: event => setStageAcceptance(event.target.value),
            })
            : h('span', { className: 'crew-muted' }, '你拍板'),
          h('button', {
            type: 'button',
            className: 'crew-choice',
            onClick: () => {
              void store.editStagePlan('add', null, {
                title: stageTitle,
                kind: stageKind,
                ...(stageKind === 'deliverable' ? { acceptance: stageAcceptance } : {}),
              })
              setStageTitle('')
              setStageAcceptance('')
            },
          }, '添加阶段'))),
    h('div', { className: 'crew-budget-edit' },
      h('button', { type: 'button', className: 'crew-choice', onClick: () => void store.exportHandoff() }, '导出交接包'),
      h('span', null, '包含 BRIEF / GOAL / CONCLUSION / transcript / events / evidence；本机绝对路径已替换为占位符。')),
    Object.keys(room.chatHolds ?? {}).length > 0
      ? h('p', { className: 'crew-dialog-note' },
        `聊天静默：${Object.keys(room.chatHolds).map(id => seats.find(seat => seat.id === id)?.name ?? id).join('、')}；在聊天里 @ 对应席位可恢复。`)
      : null,
    h('table', { className: 'crew-adv-table' },
      h('thead', null, h('tr', null,
        ['席位', '引擎', '权限', '发言预算'].map((label, index) => h('th', { key: `${label}-${index}` }, label)))),
      h('tbody', null, seats.map(seat => h('tr', { key: seat.id },
        h('td', null, seat.name),
        h('td', null, h('code', null, room.engines?.[seat.id] ?? seat.engine)),
        h('td', null, seatPermissionOf(room, seat)),
        h('td', null, `${seat.speakBudget} 次/回合`))))))
}

const FAILURE_KIND = { rework: '返工', command: '命令失败', system: '系统' }

function ReviewDialog({ review, onClose }) {
  const tokens = review.usage?.tokens ?? null
  const passedStages = review.stages.filter(stage => stage.state === 'passed').length
  const stats = [
    ['成本', review.usage?.budgetMicroUsd > 0
      ? `${money(review.usage.costMicroUsd)} / ${money(review.usage.budgetMicroUsd)}`
      : money(review.usage?.costMicroUsd ?? 0)],
    ['回合', countOf(review.usage?.turns)],
    ['Token', tokens === null
      ? '运行时未上报'
      : `${countOf(tokens.total)}（入 ${countOf(tokens.input)} / 出 ${countOf(tokens.output)}）`],
    ['证据', `${review.evidence.passed}/${review.evidence.commands} 通过`],
    ['返工', countOf(review.rework.total)],
    ['阶段', `${passedStages}/${review.stages.length}`],
  ]
  return h('div', { className: 'crew-overlay', onClick: onClose },
    h('div', { className: 'crew-dialog crew-review', onClick: event => event.stopPropagation() },
      h('div', { className: 'crew-dialog-head' },
        h('h2', null, `复盘 · ${review.name}`),
        h('button', { type: 'button', className: 'crew-ghost', onClick: onClose }, '关闭')),
      h('div', { className: 'crew-dialog-body' },
        h('div', { className: 'crew-review-stats' },
          stats.map(([label, value]) => h('div', { key: label, className: 'crew-review-stat' },
            h('span', null, label),
            h('b', { title: value }, value)))),
        h('div', { className: 'crew-review-section' },
          h('b', null, '阶段'),
          h('div', { className: 'crew-review-stages' },
            review.stages.map(stage => h('div', { key: stage.index, className: 'crew-review-stage', 'data-state': stage.state },
              h('span', { className: 'crew-review-stage-title' }, `${stage.index + 1} ${stage.title}`),
              h('span', { className: 'crew-review-stage-meta' },
                `${stage.state === 'passed' ? '已过' : stage.state === 'active' ? '进行中' : '未开始'} · 证据 ${stage.commands}${stage.failed > 0 ? ` · 失败 ${stage.failed}` : ''}${stage.rejects > 0 ? ` · 返工 ${stage.rejects}` : ''}${stage.partial?.failed?.length > 0 ? ` · 部分成功 ${stage.partial.failed.length}` : ''}`))))),
        h('div', { className: 'crew-review-section' },
          h('b', null, '失败与返工'),
          review.failures.length === 0
            ? h('p', { className: 'crew-dialog-note' }, '没有失败或返工记录。')
            : h('div', { className: 'crew-review-failures' },
              review.failures.map(item => h('div', { key: item.id, className: 'crew-review-failure', 'data-kind': item.kind },
                h('span', { className: 'crew-review-failure-time' }, timeOf(item.at)),
                h('span', { className: 'crew-review-failure-kind' }, FAILURE_KIND[item.kind] ?? '事件'),
                h('span', { className: 'crew-review-failure-text' }, item.text))))),
        review.tools.length > 0
          ? h('div', { className: 'crew-review-section' },
            h('b', null, '工具'),
            h('table', { className: 'crew-adv-table crew-review-tools' },
              h('thead', null, h('tr', null, ['工具', '次数', '失败'].map(label => h('th', { key: label }, label)))),
              h('tbody', null, review.tools.map(tool => h('tr', { key: tool.name },
                h('td', null, h('code', null, tool.name)),
                h('td', null, countOf(tool.count)),
                h('td', null, tool.failed > 0 ? countOf(tool.failed) : '—'))))))
          : null,
        h('p', { className: 'crew-dialog-note' },
          '全部从房间消息与证据派生，不新增真相源；成本与 Token 是基座上报的估算，不是账单。'))))
}

export { Advanced, ReviewDialog }
