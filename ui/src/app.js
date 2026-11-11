import { Fragment, createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { BotAvatar, BotMark, RoomAvatar } from './marks.js'
import { ArrowUpIcon } from './icons.js'
import { MarkdownText } from './primitives.js'
import { createStore, useStore } from './store.js'
import { GoalIsland } from './goal-island/index.js'
import { buildGoalView } from './goal-island/model.js'

const MD = { code: { copyLabel: '复制', copiedLabel: '已复制' } }
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

const timeOf = ts => {
  try {
    return clock.format(new Date(ts))
  } catch {
    return ''
  }
}

const money = micro => {
  const usd = micro / 1_000_000
  return `$${usd >= 1 ? usd.toFixed(2) : usd.toFixed(3)}`
}
const countOf = value => (value ?? 0).toLocaleString('zh-CN')
const independenceOf = room => room.independenceLabel ?? '独立性未标注'
const workspaceOf = room => {
  const caps = room.workspace?.capabilities
  if (!caps) return 'git（默认）'
  if (caps.vcs === 'git') {
    return `git · ${caps.isolation === 'worktree' ? 'worktree 隔离' : caps.isolation ?? '隔离'}${caps.commit === false ? ' · 无 commit' : ''}`
  }
  if (caps.vcs === 'demo') return '演示'
  return `${caps.vcs === 'none' ? '普通目录' : caps.vcs ?? '未知'} · ${caps.isolation === 'copy' ? '复制隔离' : caps.isolation ?? '隔离'} · ${caps.diff === 'manifest' ? '文件清单' : caps.diff ?? '无 diff'}`
}
const changeWordOf = room => room.workspace?.capabilities?.diff === 'manifest' ? '文件清单' : 'diff'
const seatPermissionOf = (room, seat) => {
  if (!seat.permissions?.write) return seat.permissions?.exec ? '只读 + 执行' : '只读'
  return room.workspace?.capabilities?.isolation === 'copy' ? '副本写' : 'worktree 写'
}
function Markdown({ text, variant }) {
  return h(MarkdownText, { text, labels: MD, variant })
}

function Speaker({ seat, ts }) {
  return h('div', { className: 'crew-speaker' },
    h('span', { className: 'crew-speaker-name' }, seat?.name ?? '—'),
    h('span', { className: 'crew-speaker-station' }, seat?.title ?? ''),
    h('span', { className: 'crew-speaker-time' }, timeOf(ts)))
}

function ActivityLine({ message }) {
  return h('div', { className: 'crew-activity', 'data-ok': message.meta?.ok !== false },
    h('span', { className: 'crew-activity-dot' }),
    h('span', { className: 'crew-activity-text' }, message.text),
    h('span', { className: 'crew-activity-time' }, timeOf(message.ts)))
}

function ChatLine({ message, seat }) {
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotAvatar, { bot: seat, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts }),
      h('div', { className: 'bt-bubble' }, h(Markdown, { text: message.text }))))
}

function EvidenceCard({ message, seat }) {
  const meta = message.meta ?? {}
  const ref = meta.evidenceRef
  const turn = meta.kind === 'turn'
  const command = meta.kind === 'command'
  const manual = meta.kind === 'manual'
  const passed = meta.exit === 0
  const source = meta.simulated === true ? '模拟执行 · 未真实运行' : meta.sample === true ? '样例数据' : turn ? '真实回合 · 已落盘' : manual ? '产物就绪 · 等你验收' : '命令已真实执行'
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotAvatar, { bot: seat, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts }),
      h('div', { className: 'crew-card', 'data-demo': meta.simulated === true || meta.sample === true },
        h('div', { className: 'crew-card-head' },
          command ? '证据 · 验收命令' : turn ? '证据 · 真实回合' : manual ? '证据 · 产物就绪' : `证据 · 阶段 ${(meta.stage ?? 0) + 1}`,
          command
            ? h('span', { className: 'crew-verdict', 'data-pass': passed, 'data-reject': !passed }, passed ? 'exit 0' : `exit ${meta.exit ?? '无'}`)
            : turn ? h('span', { className: 'crew-verdict', 'data-pass': true }, '基座') : null),
        h('div', { className: 'crew-card-body' },
          turn
            ? h('div', { className: 'crew-receipt' },
              h('code', null, meta.summary ?? '回合'),
              h('span', null, `${((meta.durationMs ?? 0) / 1000).toFixed(1)}s`))
            : manual
              ? h('div', { className: 'crew-receipt' },
                h('code', null, `${meta.workers?.length ?? 1} 席产物已就绪`),
                h('span', null, '等你验收'))
              : h('div', { className: 'crew-receipt' },
                h('code', null, meta.command),
                h('span', null, `exit ${meta.exit}`)),
          meta.files?.length ? h('div', { className: 'crew-receipt-files' }, meta.files.join(' · ')) : null,
          turn && meta.artifacts?.length
            ? h('details', { className: 'crew-fold' }, h('summary', null, '产物'),
              meta.artifacts.map(artifact => h('div', { key: artifact.path },
                h('code', null, `${artifact.path.split('/').at(-1)} · ${artifact.sha256.slice(0, 12)} · ${artifact.bytes}B`),
                h('pre', { className: 'crew-code' }, artifact.content))))
            : null,
          meta.output
            ? h('details', { className: 'crew-fold' }, h('summary', null, turn ? '原始回合数据' : '输出'), h('pre', { className: 'crew-code' }, meta.output))
            : null,
          meta.diff
            ? h('details', { className: 'crew-fold' },
              h('summary', null, meta.vcs !== undefined && !['git', 'demo'].includes(meta.vcs) ? '文件清单' : '改动'),
              h('pre', { className: 'crew-code' }, meta.diff))
            : null,
          meta.simulated === true ? null : message.text ? h(Markdown, { text: message.text, variant: 'compact' }) : null),
        h('div', { className: 'crew-card-foot' },
          h('span', null, source),
          ref ? h('a', {
            className: 'crew-ref',
            href: `/api/rooms/${message.roomId}/evidence/${message.id}`,
            target: '_blank',
            rel: 'noreferrer',
          }, ref) : null))))
}

function VerdictCard({ message, seat, stage, room, onAccept }) {
  const meta = message.meta ?? {}
  const pass = meta.pass === true
  const active = stage?.state === 'active'
  const independent = room.independence === 'vendor'
  const foot = meta.simulated === true
    ? `模拟复核 · ${independenceOf(room)}`
    : independent
      ? '验收只读复核 · 与执行不同厂商'
      : `验收只读复核 · ${independenceOf(room)}`
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotAvatar, { bot: seat, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts }),
      h('div', { className: 'crew-card', 'data-demo': meta.simulated === true },
        h('div', { className: 'crew-card-head' },
          `验收 · 阶段 ${(meta.stage ?? 0) + 1}`,
          h('span', { className: 'crew-verdict', 'data-pass': pass, 'data-reject': !pass }, pass ? 'PASS' : 'REJECT')),
        h('div', { className: 'crew-card-body' },
          meta.command ? h('div', { className: 'crew-kv' }, h('span', null, '命令'), h('code', null, meta.command)) : null,
          meta.exit !== undefined ? h('div', { className: 'crew-kv' }, h('span', null, '退出码'), h('code', null, String(meta.exit))) : null,
          message.text ? h(Markdown, { text: message.text, variant: 'compact' }) : null),
        h('div', { className: 'crew-card-foot' },
          foot,
          pass && active && stage?.kind === 'deliverable'
            ? h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: room.state !== 'active',
              onClick: () => onAccept(meta.stage),
            }, room.state === 'paused' ? '已暂停 · 继续后才能验收' : '接受这一阶段')
            : null,
          !active && stage?.state === 'passed' ? h('span', { className: 'crew-accepted' }, '已由你验收') : null))))
}

function ConclusionCard({ message }) {
  const meta = message.meta ?? {}
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat: { name: '结论', title: '' }, ts: message.ts }),
      h('div', { className: 'crew-card crew-conclusion' },
        h('div', { className: 'crew-card-head' }, `结论 · ${meta.stages ?? '—'} 个阶段`, h('span', { className: 'crew-verdict', 'data-pass': true }, '完成')),
        h('div', { className: 'crew-card-body' },
          h(Markdown, { text: message.text, variant: 'compact' }),
          meta.commands?.length
            ? h('div', { className: 'crew-kv' }, h('span', null, '验收'), h('code', null, meta.commands.join(' · ')))
            : null))))
}

function ImportButton({ className, onFile, children, accept = '.json,application/json' }) {
  const input = useRef(null)
  return h(Fragment, null,
    h('input', {
      ref: input,
      type: 'file',
      accept,
      style: { display: 'none' },
      onChange: event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file !== undefined) void onFile(file)
      },
    }),
    h('button', { type: 'button', className, onClick: () => input.current?.click() }, children ?? '打开交接记录'))
}

function Sidebar({ state, onSelect, onNew, onImport }) {
  const { rooms, dispatch, seats, activeId } = state
  const roster = useMemo(() => {
    const byId = Object.fromEntries(seats.map(seat => [seat.id, seat]))
    for (const room of rooms) for (const seat of room.seatSpecs ?? []) byId[seat.id] = seat
    return {
      byId,
      roomsById: Object.fromEntries(rooms.map(room => [room.id, room])),
      exchangeTurns: {},
      questions: {},
    }
  }, [seats, rooms])
  const pending = dispatch?.requests?.filter(request => request.state === 'suggested').length ?? 0
  const waiting = rooms.filter(room => room.needsYou).length

  return h('aside', { className: 'dsb-side' },
    h('div', { className: 'crew-side-brand' }, h(BotMark, { size: 22, live: false }), 'Lodge'),
    state.runtime?.ok === false
      ? h('div', { className: 'crew-error', style: { margin: '0 6px 10px' } }, `基座未连接：${state.runtime.error}`)
      : null,
    h('div', { className: 'bt-side' },
      h('div', { className: 'bt-list' },
        h('button', {
          type: 'button',
          className: 'bt-row crew-desk-row',
          'aria-current': activeId === 'dispatch' ? 'page' : undefined,
          onClick: () => onSelect('dispatch'),
        },
        h('span', { className: 'crew-desk-mark' }, '调'),
        h('span', { className: 'bt-row-body' },
          h('span', { className: 'bt-row-name' },
            h('span', { className: 'bt-row-title' }, '调度台'),
            pending > 0 ? h('span', { className: 'crew-count' }, String(pending)) : null),
          pending > 0 ? h('span', { className: 'bt-row-preview' }, '待你确认') : null)),
        h('button', {
          type: 'button',
          className: 'bt-row',
          'aria-current': activeId === 'usage' ? 'page' : undefined,
          onClick: () => onSelect('usage'),
        },
        h('span', { className: 'crew-desk-mark' }, '用'),
        h('span', { className: 'bt-row-body' },
          h('span', { className: 'bt-row-name' }, h('span', { className: 'bt-row-title' }, '用量')),
          h('span', { className: 'bt-row-preview' }, '花费 · Token · 排名'))),
        h('div', { className: 'crew-section' },
          h('span', null, '房间'),
          h('span', { className: 'crew-section-tools' },
            waiting > 0 ? h('span', { className: 'crew-needs-count' }, `${waiting} 个等你`) : null,
            h(ImportButton, { className: 'crew-new', onFile: onImport }, '打开'),
            h('button', { type: 'button', className: 'crew-new', onClick: onNew }, '＋ 新建'))),
        rooms.map(room => h(RoomRow, {
          key: room.id,
          room,
          roster,
          active: activeId === room.id,
          onSelect: () => onSelect(room.id),
        })))),
    state.budget?.globalBudgetMicroUsd > 0
      ? h('div', { className: 'crew-me' },
        h('span', { className: 'crew-me-badge' }, '预'),
        h('span', { className: 'crew-me-body' },
          h('b', null, '全局预算'),
          h('small', null, `${money(state.budget.globalSpentMicroUsd)} / ${money(state.budget.globalBudgetMicroUsd)}`)))
      : null,
    h('div', { className: 'crew-me' },
      h('span', { className: 'crew-me-badge' }, '你'),
      h('span', { className: 'crew-me-body' }, h('b', null, '你'))))
}

function RoomRow({ room, roster, active, onSelect }) {
  const needs = room.needsYou
  const preview = needs
    ? needs.label
    : room.imported === true ? '交接记录 · 只读'
      : room.live === true ? '实时 · 基座房间' : room.state === 'complete' ? '已完成' : '进行中'
  return h('button', {
    type: 'button',
    className: 'bt-row',
    'aria-current': active ? 'page' : undefined,
    onClick: onSelect,
  },
  h(RoomAvatar, { room: { ...room, members: room.members ?? [] }, roster, size: 36 }),
  h('span', { className: 'bt-row-body' },
    h('span', { className: 'bt-row-name' },
      h('span', { className: 'bt-row-title' }, room.name),
      needs ? h('span', { className: 'crew-needs-dot', 'data-kind': needs.kind, title: needs.label }) : null),
    h('span', { className: 'bt-row-preview', 'data-needs': needs?.kind }, preview)))
}

function Advanced({ room, seats, store, engines = [] }) {
  const cost = room.usage?.costMicroUsd ?? 0
  const budget = room.usage?.budgetMicroUsd ?? 0
  const percent = budget === 0 ? 0 : Math.min(100, Math.round((cost / budget) * 100))
  const availableEngines = engines.filter(item => item.available)
  const [budgetDraft, setBudgetDraft] = useState(String(budget / 1_000_000))
  useEffect(() => {
    setBudgetDraft(String(budget / 1_000_000))
  }, [room.id, budget])
  const saveBudget = () => {
    const value = Number(budgetDraft)
    if (!Number.isFinite(value) || value < 0) return
    void store.setBudget(value)
  }
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
    room.imported === true
      ? null
      : h('div', { className: 'crew-budget-edit' },
        h('span', null, '房间预算（美元，0 为不限）'),
        h('input', {
          type: 'number',
          min: 0,
          step: 1,
          value: budgetDraft,
          onChange: event => setBudgetDraft(event.target.value),
        }),
        h('button', { type: 'button', className: 'crew-choice', onClick: saveBudget }, '保存')),
    h('div', { className: 'crew-budget-edit' },
      room.imported === true
        ? h('span', null, '这是导入的只读交接记录；用「基于此记录续做」开一个新房间。')
        : h('button', { type: 'button', className: 'crew-choice', onClick: () => void store.exportHandoff() }, '导出交接包'),
      room.imported === true
        ? null
        : h('span', null, '包含 BRIEF / GOAL / CONCLUSION / transcript / events / evidence；本机绝对路径已替换为占位符。')),
    h('table', { className: 'crew-adv-table' },
      h('thead', null, h('tr', null,
        ['席位', '引擎', '权限', '发言预算'].map(label => h('th', { key: label }, label)))),
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

function StageAction({ room, stage, index, onAccept, onAnswer }) {
  const blocked = Boolean(room.openQuestion)
  const locked = room.state !== 'active'
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const canConfirm = !locked && (!blocked || draft.trim() !== '')

  const confirm = async () => {
    if (!canConfirm || busy) return
    setBusy(true)
    if (blocked) await onAnswer(index, draft.trim())
    else await onAccept(index)
    setBusy(false)
  }

  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h('div', { className: 'crew-card crew-human-gate' },
        h('div', { className: 'crew-card-head' },
          `阶段 ${index + 1}`,
          h('span', { className: 'crew-verdict', 'data-pending': true }, blocked ? '等你回答' : '等你拍板')),
        h('div', { className: 'crew-card-body' },
          h('div', { className: 'crew-gate-title' }, stage.title),
          blocked ? h('p', { className: 'crew-gate-question' }, room.openQuestion) : null,
          blocked
            ? h('textarea', {
              className: 'crew-gate-input',
              rows: 2,
              value: draft,
              placeholder: '你的决定…',
              onChange: event => setDraft(event.target.value),
              onKeyDown: event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void confirm()
                }
              },
            })
            : null),
        h('div', { className: 'crew-card-foot' },
          h('button', {
            type: 'button',
            className: 'crew-accept',
            disabled: !canConfirm || busy,
            onClick: () => void confirm(),
          }, blocked ? '回答并确认' : '确认这一阶段')))))
}

function DemoStep({ stage, index, onSimulate }) {
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h('div', { className: 'crew-card' },
        h('div', { className: 'crew-card-head' },
          `阶段 ${index + 1}`,
          h('span', { className: 'crew-verdict', 'data-pending': true }, '演示')),
        h('div', { className: 'crew-card-body' },
          h('p', { className: 'crew-muted' },
            `\`${stage.acceptance ?? 'npm test'}\` 还没真实跑过，这一步用模拟数据走完流程。`)),
        h('div', { className: 'crew-card-foot' },
          h('button', { type: 'button', className: 'crew-accept', onClick: onSimulate }, '模拟执行并复核')))))
}

function LiveGate({ room, stage, index, onSetAcceptance, onVerify, onAccept }) {
  const [draft, setDraft] = useState(stage.acceptance ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setDraft(stage.acceptance ?? '') }, [stage.acceptance])
  const evidence = [...room.messages].reverse().find(message => (
    message.kind === 'evidence' && message.meta?.kind === 'command' && message.meta?.stage === index
  ))
  const exit = evidence?.meta?.exit
  const hasVerifier = (room.verifiers?.length ?? 0) > 0
  const locked = room.state !== 'active'
  const changed = draft.trim() !== (stage.acceptance ?? '')

  const save = async () => {
    if (busy || locked) return
    setBusy(true)
    await onSetAcceptance(index, draft.trim())
    setBusy(false)
  }
  const verify = async () => {
    if (busy || locked) return
    setBusy(true)
    await onVerify(index)
    setBusy(false)
  }

  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h('div', { className: 'crew-card crew-human-gate' },
        h('div', { className: 'crew-card-head' },
          `阶段 ${index + 1} · 真实验收`,
          h('span', { className: 'crew-verdict', 'data-pending': true }, exit === 0 ? '等待复核' : '等待命令')),
        h('div', { className: 'crew-card-body' },
          h('div', { className: 'crew-gate-title' }, stage.title),
          h('p', { className: 'crew-gate-question' },
            room.repoPath
              ? `验收命令在房间工作区里真实执行；退出码、输出与${changeWordOf(room)}会落成证据。`
              : '房间没有固定工作目录，验收命令不会执行。先给基座群设置工作目录。'),
          h('textarea', {
            className: 'crew-gate-input',
            rows: 2,
            value: draft,
            placeholder: '例如：npm test',
            disabled: locked,
            onChange: event => setDraft(event.target.value),
          }),
          evidence
            ? h('div', { className: 'crew-receipt' },
              h('code', null, evidence.meta.command),
              h('span', null, `exit ${exit ?? '无'}`),
              h('span', null, `${((evidence.meta.durationMs ?? 0) / 1000).toFixed(1)}s`))
            : null,
          h('p', { className: 'crew-dialog-note' }, `${hasVerifier ? '复核由验收席位执行' : '没有独立验收席位'} · ${independenceOf(room)}`)),
        h('div', { className: 'crew-card-foot' },
          h('button', {
            type: 'button',
            className: 'crew-ghost',
            disabled: busy || locked || !changed,
            onClick: () => void save(),
          }, '保存命令'),
          evidence && exit === 0 && hasVerifier
            ? h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: busy || locked,
              onClick: () => void verify(),
            }, busy ? '等待复核…' : '请求独立复核')
            : null,
          evidence && exit === 0 && !hasVerifier
            ? h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: locked,
              onClick: () => onAccept(index),
            }, '接受这一阶段')
            : null,
          evidence && exit !== 0
            ? h('span', { className: 'crew-muted' }, '命令未通过：返工后重跑')
            : null))))
}

function Timeline({ room, seats, onAccept, onAnswer, onSimulate, onSetAcceptance, onVerify }) {
  const byId = useMemo(() => Object.fromEntries(seats.map(seat => [seat.id, seat])), [seats])
  const activeIndex = room.stages.findIndex(stage => stage.state === 'active')
  const activeStage = room.stages[activeIndex]
  const hasPass = activeIndex >= 0 && room.messages.some(message => (
    message.kind === 'verdict' && message.meta?.pass === true && message.meta?.stage === activeIndex
  ))
  const manualReady = activeStage?.manual === true && room.messages.some(message => (
    message.kind === 'evidence' && message.meta?.kind === 'manual' && (message.meta?.stage ?? 0) === activeIndex
  ))

  return [
    ...room.messages.map(message => {
      const seat = byId[message.authorId] ?? (message.authorId === 'system' ? { name: '运行时', title: '验收' } : undefined)
      if (message.kind === 'system') return h('div', { key: message.id, className: 'crew-system' }, message.text)
      if (message.kind === 'activity') return h(ActivityLine, { key: message.id, message })
      if (message.kind === 'evidence') return h(EvidenceCard, { key: message.id, message, seat })
      if (message.kind === 'conclusion') return h(ConclusionCard, { key: message.id, message })
      if (message.kind === 'verdict') {
        return h(VerdictCard, {
          key: message.id,
          message,
          seat,
          room,
          stage: room.stages[message.meta?.stage ?? 0],
          onAccept,
        })
      }
      if (message.authorId === 'you') {
        return h('div', { key: message.id, className: 'crew-human' },
          h('div', { className: 'bt-ububble' }, h(Markdown, { text: message.text, variant: 'compact' })))
      }
      return h(ChatLine, { key: message.id, message, seat })
    }),
    activeStage?.kind === 'decision' && (activeStage.manual !== true || manualReady)
      ? h(StageAction, { key: 'gate', room, stage: activeStage, index: activeIndex, onAccept, onAnswer })
      : null,
    activeStage?.kind === 'deliverable' && room.live === true && !hasPass
      ? h(LiveGate, { key: 'live-gate', room, stage: activeStage, index: activeIndex, onSetAcceptance, onVerify, onAccept })
      : null,
    activeStage?.kind === 'deliverable' && room.demo === true && !hasPass
      ? h(DemoStep, { key: 'demo', stage: activeStage, index: activeIndex, onSimulate })
      : null,
  ].filter(Boolean)
}

function DispatchCard({ request, onConfirm, onDecline, onOpen }) {
  const suggestion = request.suggestion
  return h('div', { className: 'crew-req' },
    h('div', { className: 'crew-req-head' },
      h('span', { className: 'crew-req-text' }, request.text),
      h('span', { className: 'crew-req-time' }, timeOf(request.at))),
    h('div', { className: 'crew-req-body' },
      h('div', { className: 'crew-sug' },
        h('span', null, '建议交给 '),
        h('button', { type: 'button', className: 'crew-link', onClick: onOpen }, suggestion.roomName),
        h('span', null, ` · ${suggestion.seatName}`)),
      h('p', { className: 'crew-req-reason' }, suggestion.reason)),
    h('div', { className: 'crew-req-foot' },
      h('button', { type: 'button', className: 'crew-ghost', onClick: onDecline }, '驳回'),
      h('button', { type: 'button', className: 'crew-accept', onClick: onConfirm }, '确认')))
}

function DigestItem({ item, onOpen }) {
  const stateText = item.state === 'complete'
    ? '已完成'
    : item.stage
      ? `阶段 ${item.stage.index}/${item.stage.total} · ${item.stage.title}`
      : '待总结'
  return h('button', { type: 'button', className: 'crew-digest-item', onClick: onOpen },
    h('span', { className: 'crew-digest-main' },
      h('span', { className: 'crew-digest-room' }, item.roomName),
      h('span', { className: 'crew-digest-state', 'data-done': item.state === 'complete' }, stateText)),
    h('span', { className: 'crew-digest-evidence' },
      item.evidence ? `${item.evidence.command} · exit ${item.evidence.exit}` : '暂无证据'),
    item.needsYou
      ? h('span', { className: 'crew-digest-needs', 'data-kind': item.needsYou.kind },
        item.needsYou.kind === 'question' && item.openQuestion
          ? `未决：${item.openQuestion}`
          : item.needsYou.label)
      : null)
}

const ROOM_STATE_LABEL = { active: '进行中', paused: '已暂停', stopped: '已停止', complete: '已完成' }

function ResourcePanel({ resources, usage, store }) {
  if (resources === null || resources === undefined) {
    return h('div', { className: 'crew-resource' }, h('p', { className: 'crew-muted' }, '资源面板加载中…'))
  }
  const g = resources.global
  const stats = [
    ['花费', g.budgetMicroUsd > 0 ? `${money(g.costMicroUsd)} / ${money(g.budgetMicroUsd)}` : `${money(g.costMicroUsd)} / 不限`],
    ['房间', `${g.rooms} · 活跃 ${g.active} / 暂停 ${g.paused}`],
    ['完成 / 停止', `${g.complete} / ${g.stopped}`],
    ['待你处理', countOf(g.needsYou)],
    ['失败命令', countOf(g.failedCommands)],
    ['返工', countOf(g.rework)],
    ['冲突 / 部分成功', `${g.conflicts} / ${g.partial}`],
    ['回合', countOf(g.turns)],
  ]
  return h('div', { className: 'crew-resource' },
    h('div', { className: 'crew-resource-head' },
      h('b', null, '资源'),
      h('span', { className: 'crew-muted' }, '只读 · 不路由、不执行'),
      h('button', { type: 'button', className: 'crew-ghost', onClick: () => void store.loadResources() }, '刷新')),
    h('div', { className: 'crew-resource-stats' },
      stats.map(([label, value]) => h('div', { key: label, className: 'crew-resource-stat' },
        h('span', null, label),
        h('b', { title: value }, value)))),
    usage !== null && usage !== undefined
      ? h('div', { className: 'crew-usage-trend' },
        h('div', { className: 'crew-usage-bars' },
          usage.buckets.map(bucket => h('i', {
            key: bucket.day,
            style: { height: `${Math.max(4, Math.round((bucket.costMicroUsd / Math.max(1, ...usage.buckets.map(item => item.costMicroUsd))) * 100))}%` },
            title: `${bucket.day} · ${money(bucket.costMicroUsd)} · ${bucket.turns} 回合`,
          }))),
        h('span', { className: 'crew-muted' },
          `${usage.range} · Tokens ${countOf(usage.totals.tokens.input + usage.totals.tokens.output)}`))
      : null,
    h('div', { className: 'crew-resource-rooms' },
      resources.rooms.map(item => h('button', {
        key: item.roomId,
        type: 'button',
        className: 'crew-resource-room',
        onClick: () => store.select(item.roomId),
      },
      h('span', { className: 'crew-resource-name' }, item.name),
      h('span', { className: 'crew-resource-state', 'data-state': item.state }, ROOM_STATE_LABEL[item.state] ?? item.state),
      h('span', null, money(item.costMicroUsd)),
      h('span', null, `${countOf(item.turns)} 回合`),
      h('span', { className: 'crew-muted' }, item.needsYou?.label ?? ''),
      h('span', { className: 'crew-muted' },
        [item.rework > 0 ? `返工 ${item.rework}` : '', item.failedCommands > 0 ? `失败 ${item.failedCommands}` : ''].filter(Boolean).join(' · '))))),
    h('p', { className: 'crew-resource-note' }, '成本是基座上报的估算，不是账单。'))
}

function DispatchView({ state, store }) {
  const { dispatch, resources, usage } = state
  const roomSignature = state.rooms
    .map(room => `${room.id}:${room.state}:${room.usage?.costMicroUsd ?? 0}:${room.usage?.turns ?? 0}:${room.needsYou?.kind ?? ''}:${room.messages?.length ?? 0}`)
    .join('|')
  useEffect(() => {
    void store.loadResources()
    void store.loadUsage()
  }, [store, roomSignature])
  if (dispatch === null) return null
  const pending = dispatch.requests.filter(request => request.state === 'suggested')
  const decided = dispatch.requests.filter(request => request.state !== 'suggested')

  return h('main', { className: 'dsb-main' },
    h('header', { className: 'crew-head crew-desk-head' },
      h('div', { className: 'crew-title' },
        h('h1', null, '调度台'),
        h('span', { className: 'crew-badge' }, '只建议 · 你确认'))),
    h('div', { className: 'dsb-scroll crew-scroll' },
      h('div', { className: 'crew-flow' },
        h(ResourcePanel, { resources, usage, store }),
        h('div', { className: 'crew-section-title' }, `待你确认 · ${pending.length}`),
        pending.length === 0
          ? h('p', { className: 'crew-muted' }, '没有新的请求。')
          : pending.map(request => h(DispatchCard, {
            key: request.id,
            request,
            onConfirm: () => void store.dispatchConfirm(request.id),
            onDecline: () => void store.dispatchDecline(request.id),
            onOpen: () => store.select(request.suggestion.roomId),
          })),
        h('div', { className: 'crew-section-title' }, '已处理'),
        decided.length === 0
          ? h('p', { className: 'crew-muted' }, '还没有处理过的请求。')
          : decided.map(request => h('div', { key: request.id, className: 'crew-done-row' },
            h('span', { className: 'crew-done-text' }, request.text),
            h('span', { className: 'crew-done-target' }, request.suggestion.roomName),
            h('span', { className: 'crew-done-state', 'data-declined': request.state === 'declined' },
              request.state === 'confirmed' ? '已派' : '已驳回'))),
        h('div', { className: 'crew-section-title' }, '汇总'),
        dispatch.digest.map(item => h(DigestItem, {
          key: item.roomId,
          item,
          onOpen: () => store.select(item.roomId),
        })))),
    h('div', { className: 'dsb-composer' },
      h(Composer, {
        placeholder: '说说你想做什么，我建议交给哪个群…',
        disabled: state.phase === 'loading',
        onSend: text => store.dispatchAsk(text),
      })))
}

const USAGE_RANGES = [['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天'], ['12w', '12 周'], ['12m', '12 月']]

function UsageView({ state, store }) {
  const [range, setRange] = useState('7d')
  useEffect(() => {
    void store.loadUsage(range)
  }, [store, range])
  const usage = state.usage
  const totals = usage?.totals
  const tokens = totals === undefined ? 0 : totals.tokens.input + totals.tokens.output
  const cacheBase = totals === undefined ? 0 : totals.tokens.input + totals.tokens.cachedInput
  const cacheRate = cacheBase === 0 ? 0 : Math.round((totals.tokens.cachedInput / cacheBase) * 100)
  const peak = usage === undefined || usage === null ? 1 : Math.max(1, ...usage.buckets.map(bucket => bucket.costMicroUsd))
  const stats = usage === null || usage === undefined
    ? []
    : [
        ['花费', usage.budgetMicroUsd > 0 ? `${money(totals.costMicroUsd)} / ${money(usage.budgetMicroUsd)}` : money(totals.costMicroUsd)],
        ['Token', countOf(tokens)],
        ['缓存命中', `${cacheRate}%`],
        ['回合', countOf(totals.turns)],
        ['房间', countOf(usage.rooms.filter(room => room.costMicroUsd > 0).length)],
      ]
  return h('main', { className: 'dsb-main' },
    h('header', { className: 'crew-head crew-desk-head' },
      h('div', { className: 'crew-title' },
        h('h1', null, '用量'),
        h('span', { className: 'crew-badge' }, '只读 · 基座估算'))),
    h('div', { className: 'dsb-scroll crew-scroll' },
      h('div', { className: 'crew-flow' },
        h('div', { className: 'crew-usage-tabs' },
          USAGE_RANGES.map(([id, label]) => h('button', {
            key: id,
            type: 'button',
            className: 'crew-choice',
            'data-on': range === id,
            onClick: () => setRange(id),
          }, label))),
        usage === null || usage === undefined
          ? h('p', { className: 'crew-muted' }, '用量账本加载中…')
          : h(Fragment, null,
            h('div', { className: 'crew-usage-stats' },
              stats.map(([label, value]) => h('div', { key: label, className: 'crew-usage-stat' },
                h('span', null, label),
                h('b', { title: value }, value)))),
            h('div', { className: 'crew-usage-chart' },
              h('div', { className: 'crew-usage-bars' },
                usage.buckets.map(bucket => h('div', { key: bucket.key, className: 'crew-usage-column', title: `${bucket.label} · ${money(bucket.costMicroUsd)} · ${bucket.turns} 回合` },
                  h('i', { style: { height: `${Math.max(3, Math.round((bucket.costMicroUsd / peak) * 100))}%` } })))),
              h('div', { className: 'crew-usage-axis' },
                h('span', null, usage.buckets[0]?.label ?? ''),
                h('span', null, usage.buckets.at(-1)?.label ?? ''))),
            h('div', { className: 'crew-section-title' }, '房间排名'),
            usage.rooms.length === 0
              ? h('p', { className: 'crew-muted' }, '这个区间没有用量。')
              : h('div', { className: 'crew-usage-rooms' },
                usage.rooms.map(room => h('button', {
                  key: room.roomId,
                  type: 'button',
                  className: 'crew-usage-room',
                  onClick: () => store.select(room.roomId),
                },
                h('span', { className: 'crew-resource-name' }, room.name),
                h('span', null, money(room.costMicroUsd)),
                h('span', null, `${countOf(room.turns)} 回合`),
                h('span', { className: 'crew-muted' }, `${countOf(room.tokens.input + room.tokens.output)} Token`)))),
            h('p', { className: 'crew-resource-note' },
              '成本与 Token 来自基座上报的估算，不是账单；导入的交接记录不计入当前用量。')))))
}

function Composer({ placeholder, disabled, onSend }) {
  const [draft, setDraft] = useState('')

  const send = () => {
    const text = draft.trim()
    if (text === '' || disabled) return
    setDraft('')
    void onSend(text)
  }

  return h('div', { className: 'crew-composer' },
    h('textarea', {
      className: 'crew-input',
      rows: 1,
      value: draft,
      placeholder,
      disabled,
      onChange: event => setDraft(event.target.value),
      onKeyDown: event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          send()
        }
      },
    }),
    h('button', { type: 'button', className: 'crew-send', 'aria-label': '发送', disabled: disabled || draft.trim() === '', onClick: send },
      h(ArrowUpIcon)))
}

function RoomView({ state, room, store, onContinue }) {
  const [advanced, setAdvanced] = useState(false)
  const scroll = useRef(null)
  const lastId = room.messages.at(-1)?.id

  useEffect(() => {
    const node = scroll.current
    if (node) node.scrollTop = node.scrollHeight
  }, [lastId])

  const locked = room.state === 'paused' || room.state === 'stopped' || room.imported === true
  const seats = useMemo(() => {
    if (Array.isArray(room.seatSpecs) && room.seatSpecs.length > 0) return room.seatSpecs
    const ids = room.members ?? []
    return ids.length === 0 ? state.seats : state.seats.filter(seat => ids.includes(seat.id))
  }, [room.seatSpecs, room.members, state.seats])
  const goalView = useMemo(() => buildGoalView(room, seats), [room, seats])
  const goalActions = {
    review: () => void store.openReview(room.id),
    toggleAdvanced: () => setAdvanced(value => !value),
    pause: () => void store.pause(),
    resume: () => void store.resume(),
    stop: () => void store.stop(),
    ...(onContinue === undefined ? {} : { continue: () => onContinue(room) }),
  }

  return h('main', { className: 'dsb-main' },
    h(GoalIsland, { view: goalView, advanced, actions: goalActions }),
    advanced ? h(Advanced, { room, seats, store, engines: state.engines }) : null,
    state.reviewFor === room.id && state.review !== null
      ? h(ReviewDialog, { review: state.review, onClose: () => store.closeReview() })
      : null,
    h('div', { ref: scroll, className: 'dsb-scroll crew-scroll' },
      h('div', { className: 'crew-flow' }, h(Timeline, {
        room,
        seats,
        onAccept: stage => void store.accept(stage),
        onAnswer: (stage, text) => void store.answer(stage, text),
        onSimulate: () => void store.simulate(),
        onSetAcceptance: (stage, command) => void store.setAcceptance(stage, command),
        onVerify: stage => void store.verify(stage),
      })),
      state.error ? h('div', { className: 'crew-error' }, state.error) : null),
    h('div', { className: 'dsb-composer' },
      h(Composer, {
        placeholder: room.imported === true
          ? '交接记录 · 只读'
          : room.state === 'complete'
          ? '这次交付已结束；说话可以开新一轮…'
          : room.state === 'paused'
            ? '已暂停 · 继续后才能派新活'
            : room.state === 'stopped'
              ? '已停止 · 不会再派新活'
              : '对房间说话…',
        disabled: state.phase === 'loading' || locked,
        onSend: text => store.send(text),
      })))
}

const INITIAL_SEATS = () => [
  { key: 'lead', role: 'lead', label: '队长', name: '队长', on: true },
  { key: 'worker-1', role: 'worker', label: '执行', name: '执行', on: true, required: true },
  { key: 'verifier', role: 'verifier', label: '验收', name: '验收', on: true },
]
const ROLE_LABEL = { lead: '队长', worker: '执行', verifier: '验收' }

// 队长只给角色与名字；权限仍由服务端按角色派生。
const seatsFromProposal = proposal => {
  const lead = proposal.seats.find(seat => seat.role === 'lead')
  const verifier = proposal.seats.find(seat => seat.role === 'verifier')
  const workers = proposal.seats.filter(seat => seat.role === 'worker')
  return [
    { key: 'lead', role: 'lead', label: '队长', name: lead?.name ?? '队长', on: lead !== undefined },
    ...workers.map((seat, index) => ({
      key: `worker-${index + 1}`,
      role: 'worker',
      label: '执行',
      name: seat.name,
      on: true,
      required: true,
    })),
    { key: 'verifier', role: 'verifier', label: '验收', name: verifier?.name ?? '验收', on: verifier !== undefined },
  ]
}

function NewRoomDialog({ open, onClose, onCreate, onRecommend, onProjectConstraints, onParseTemplate, templates = [], resume = null }) {
  const choices = templates.length > 0 ? templates : [{ id: 'delivery-triad', name: '交付三人组', seats: 3 }, { id: 'solo', name: '单人', seats: 1 }]
  const templateChoices = [...choices, { id: 'custom', name: '自定义', seats: null }]
  const [step, setStep] = useState(0)
  const [templateId, setTemplateId] = useState(choices[0]?.id ?? 'delivery-triad')
  const [seats, setSeats] = useState(INITIAL_SEATS)
  const [goal, setGoal] = useState('')
  const [verify, setVerify] = useState('test')
  const [acceptance, setAcceptance] = useState('npm test')
  const [repoPath, setRepoPath] = useState('')
  const [constraints, setConstraints] = useState('')
  const [constraintsPath, setConstraintsPath] = useState(null)
  const [constraintLayers, setConstraintLayers] = useState([])
  const [constraintsChecked, setConstraintsChecked] = useState(false)
  const [includeConstraints, setIncludeConstraints] = useState(false)
  const [constraintsLoading, setConstraintsLoading] = useState(false)
  const [importedTemplate, setImportedTemplate] = useState(null)
  const [proposal, setProposal] = useState(null)
  const [answers, setAnswers] = useState([])
  const [manual, setManual] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open || resume === null) return
    setGoal(resume.brief?.objective || resume.goal || '')
    setStep(0)
    setProposal(null)
    setAnswers([])
    setManual(false)
    setError(null)
  }, [open, resume?.id])

  if (!open) return null

  const custom = templateId === 'custom'
  const needRepo = resume !== null && repoPath.trim() === ''
  const activeSeats = seats.filter(seat => seat.on)
  const hasVerifier = custom
    ? activeSeats.some(seat => seat.role === 'verifier')
    : templateId !== 'solo'
  const toggleSeat = key => setSeats(list => list.map(seat => (
    seat.key === key && seat.role !== 'worker' ? { ...seat, on: !seat.on } : seat
  )))
  const renameSeat = (key, name) => setSeats(list => list.map(seat => (
    seat.key === key ? { ...seat, name } : seat
  )))
  const addWorker = () => setSeats(list => {
    const count = list.filter(seat => seat.role === 'worker').length + 1
    return [...list, {
      key: `worker-${Math.random().toString(36).slice(2, 8)}`,
      role: 'worker',
      label: '执行',
      name: `执行 ${count}`,
      on: true,
      required: true,
    }]
  })
  const removeWorker = key => setSeats(list => (
    list.filter(seat => seat.role === 'worker' && seat.on).length <= 1
      ? list
      : list.filter(seat => seat.key !== key)
  ))
  const workerCount = activeSeats.filter(seat => seat.role === 'worker').length
  const rosterName = activeSeats.map(seat => seat.name.trim() || seat.label).join('、')

  const useProposal = proposal !== null && !manual

  const loadConstraints = async () => {
    const source = repoPath.trim()
    if (source === '' || constraintsLoading) return
    setConstraintsLoading(true)
    setConstraintsChecked(true)
    const result = await onProjectConstraints(source)
    setConstraintsLoading(false)
    if (result?.ok !== true) {
      setError(result?.error ?? '读取项目约束失败')
      return
    }
    setConstraintsPath(result.path)
    setConstraintLayers(result.layers ?? [])
    setConstraints(result.content ?? '')
    setIncludeConstraints(typeof result.content === 'string' && result.content.trim() !== '')
  }

  const loadTemplate = async file => {
    const result = await onParseTemplate(file.name, await file.text())
    if (result?.ok !== true) {
      setError(result?.error ?? '模板解析失败')
      return
    }
    setImportedTemplate(result.template)
    setError(null)
  }

  const useImportedTemplate = () => {
    if (importedTemplate === null) return
    setTemplateId('custom')
    setSeats(importedTemplate.seats.map((seat, index) => ({
      key: `template-${index}`,
      role: seat.role,
      label: ROLE_LABEL[seat.role] ?? seat.role,
      name: seat.name,
      on: true,
      required: seat.role === 'worker',
      prompt: seat.prompt,
      station: seat.station,
      engine: seat.engine,
    })))
    setManual(true)
    setProposal(null)
    setStep(1)
  }

  const recommend = async () => {
    if (goal.trim() === '' || recommending) return
    setRecommending(true)
    setError(null)
    const result = await onRecommend(goal.trim(), repoPath.trim())
    setRecommending(false)
    if (result?.ok !== true) {
      setError(result?.error ?? '队长没有给出建议')
      setManual(true)
      setTemplateId('custom')
      setSeats(INITIAL_SEATS)
      setStep(1)
      return
    }
    setProposal(result.proposal)
    setAnswers(result.proposal.questions.map(question => question.recommendation))
    setManual(false)
    setTemplateId('custom')
    setSeats(seatsFromProposal(result.proposal))
    setVerify(result.proposal.verify)
    setAcceptance(result.proposal.acceptance ?? '')
    setStep(1)
  }

  const chooseManual = () => {
    if (proposal !== null) setSeats(seatsFromProposal(proposal))
    setManual(true)
    setTemplateId('custom')
    setStep(1)
  }

  const start = async () => {
    setBusy(true)
    setError(null)
    const roster = useProposal
      ? proposal.seats.map(({ role, name }) => ({ role, name }))
      : activeSeats.map(seat => ({
        role: seat.role,
        name: seat.name.trim() || seat.label,
        ...(seat.prompt ? { prompt: seat.prompt } : {}),
        ...(seat.station ? { station: seat.station } : {}),
        ...(seat.engine ? { engine: seat.engine } : {}),
      }))
    const result = await onCreate(goal.trim(), {
      verify,
      acceptance: acceptance.trim(),
      repoPath: repoPath.trim(),
      ...(resume === null ? {} : { continueFrom: resume.id }),
      ...(includeConstraints && constraints.trim() !== '' ? { projectConstraints: constraints } : {}),
      ...(useProposal || custom ? { seats: roster } : { templateId }),
      ...(useProposal ? {
        plan: {
          done: proposal.done,
          why: proposal.why,
          answers: proposal.questions.map((question, index) => ({
            question: question.text,
            answer: answers[index] ?? question.recommendation,
          })),
        },
      } : {}),
    })
    setBusy(false)
    if (result?.ok === true) {
      setGoal('')
      setStep(0)
      setProposal(null)
      setAnswers([])
      setManual(false)
      setConstraints('')
      setConstraintsPath(null)
      setConstraintLayers([])
      setConstraintsChecked(false)
      setIncludeConstraints(false)
      setImportedTemplate(null)
      setError(null)
      onClose()
    } else {
      setError(result?.error ?? '建房失败')
    }
  }

  const verification = [
    h('div', { key: 'verify', className: 'crew-q' },
      h('b', null, '完成后怎么验证？'),
      h('div', { className: 'crew-choices' },
        [['test', '跑一条命令（推荐）'], ['manual', '我自己看一眼']].map(([id, label]) => h('button', {
          key: id,
          type: 'button',
          className: 'crew-choice',
          'data-on': verify === id,
          onClick: () => setVerify(id),
        }, label)))),
    verify === 'test'
      ? h('div', { key: 'acceptance', className: 'crew-q' },
        h('b', null, '验收命令'),
        h('input', {
          className: 'crew-goal-input',
          type: 'text',
          value: acceptance,
          placeholder: '例如：npm test',
          onChange: event => setAcceptance(event.target.value),
        }))
      : null,
  ]

  const manualBody = h(Fragment, null,
    h('div', { className: 'crew-q' },
      h('b', null, '编制'),
      h('div', { className: 'crew-choices' },
        templateChoices.map(template => h('button', {
          key: template.id,
          type: 'button',
          className: 'crew-choice',
          'data-on': templateId === template.id,
          onClick: () => setTemplateId(template.id),
        }, template.seats === null ? `${template.name}（按需）` : `${template.name}（${template.seats} 席）`)))),
    custom
      ? h('div', { className: 'crew-q' },
        h('b', null, '角色（执行至少一个，可并行）'),
        h('div', { className: 'crew-choices' },
          seats.filter(seat => seat.role !== 'worker').map(seat => h('button', {
            key: seat.key,
            type: 'button',
            className: 'crew-choice',
            'data-on': seat.on,
            onClick: () => toggleSeat(seat.key),
          }, seat.label)),
          h('button', {
            type: 'button',
            className: 'crew-choice',
            onClick: addWorker,
          }, '＋ 添加执行')),
        h('b', null, '席位名字'),
        seats.filter(seat => seat.on).map(seat => h('div', { key: seat.key, className: 'crew-seat-line' },
          h('input', {
            className: 'crew-goal-input',
            type: 'text',
            value: seat.name,
            placeholder: seat.label,
            onChange: event => renameSeat(seat.key, event.target.value),
          }),
          seat.role === 'worker' && workerCount > 1
            ? h('button', {
              type: 'button',
              className: 'crew-choice',
              onClick: () => removeWorker(seat.key),
            }, '移除')
            : null)))
      : null)

  const proposalBody = useProposal
    ? h('div', { className: 'crew-q' },
      h('b', null, '队长的开工卡'),
      h('p', { className: 'crew-dialog-lead' },
        `${proposal.seats.length} 席${proposal.why === '' ? '' : ` · ${proposal.why}`}`),
      h('b', null, '做完的样子'),
      h('ul', { className: 'crew-brief' },
        proposal.done.map((text, index) => h('li', { key: `done-${index}` }, text))),
      proposal.questions.length > 0
        ? h(Fragment, null,
          h('b', null, '要你拍板'),
          proposal.questions.map((question, index) => h('div', { key: `q-${index}`, className: 'crew-q' },
            h('span', null, `${index + 1}. ${question.text}`),
            h('input', {
              className: 'crew-goal-input',
              type: 'text',
              value: answers[index] ?? '',
              placeholder: question.recommendation,
              onChange: event => setAnswers(list => list.map((item, at) => at === index ? event.target.value : item)),
            }))))
        : h('p', { className: 'crew-island-soft' }, '没有需要你额外拍板的问题。'),
      h('b', null, '编制'),
      h('ul', { className: 'crew-brief' },
        proposal.seats.map((seat, index) => h('li', { key: `${seat.role}-${index}` },
          `${ROLE_LABEL[seat.role]}${seat.name === ROLE_LABEL[seat.role] ? '' : `「${seat.name}」`}${seat.reason === '' ? '' : ` · ${seat.reason}`}`))),
      proposal.note === '' ? null : h('p', { className: 'crew-dialog-note' }, proposal.note),
      verify === 'manual'
        ? h('p', { className: 'crew-dialog-note' },
          hasVerifier
            ? '人工验收模式不需要验收席位；要独立复核就补一条验收命令。'
            : '验收方式：你自己看产物；这一步没有命令证据。')
        : null)
    : null

  const body = step === 0
    ? h('div', { className: 'crew-dialog-body' },
      h('p', { className: 'crew-dialog-lead' }, '一句话说目标，可以很糙。'),
      h('textarea', {
        className: 'crew-goal-input',
        rows: 3,
        autoFocus: true,
        value: goal,
        placeholder: '例如：给 CLI 加个 verbose',
        onChange: event => setGoal(event.target.value),
      }),
      h('div', { className: 'crew-q' },
        h('b', null, resume === null ? '工作目录（可选）' : '工作目录（续做必填）'),
        h('input', {
          className: 'crew-goal-input',
          type: 'text',
          value: repoPath,
          placeholder: resume === null ? '留空则让队长在新建的空仓库里判断' : '上一轮交付所在的本地仓库或目录',
          onChange: event => setRepoPath(event.target.value),
          onBlur: () => void loadConstraints(),
        })),
      h('div', { className: 'crew-q crew-constraints' },
        h('div', { className: 'crew-constraints-head' },
          h('b', null, '项目约束（LODGE.md）'),
          h('button', {
            type: 'button',
            className: 'crew-ghost',
            disabled: repoPath.trim() === '' || constraintsLoading,
            onClick: () => void loadConstraints(),
          }, constraintsLoading ? '读取中…' : '读取')),
        constraintsPath !== null
          ? h(Fragment, null,
            h('label', { className: 'crew-check' },
              h('input', {
                type: 'checkbox',
                checked: includeConstraints,
                onChange: event => setIncludeConstraints(event.target.checked),
              }),
              `带入这个房间 · ${constraintsPath}`),
            constraintLayers.length > 0
              ? h('div', { className: 'crew-constraint-layers' },
                constraintLayers.map(layer => h('span', { key: layer.path }, `${layer.name} · ${layer.path} · ${layer.bytes}B`)))
              : null,
            h('textarea', {
              className: 'crew-goal-input',
              rows: 4,
              value: constraints,
              disabled: !includeConstraints,
              onChange: event => setConstraints(event.target.value),
            }),
            h('p', { className: 'crew-dialog-note' },
              '修改只影响这个房间；要长期生效，请编辑仓库根目录的 LODGE.md。'))
          : constraintsChecked
            ? h('p', { className: 'crew-island-soft' }, '这个工作目录没有 LODGE.md。')
            : null),
      h('div', { className: 'crew-q crew-constraints' },
        h('div', { className: 'crew-constraints-head' },
          h('b', null, '本地模板'),
          h(ImportButton, {
            className: 'crew-ghost',
            accept: '.crew.yaml,.yaml,.yml,.json,application/json',
            onFile: file => void loadTemplate(file),
          }, '导入 .crew.yaml')),
        importedTemplate === null
          ? h('p', { className: 'crew-island-soft' }, '从本地文件读取席位与提示词；权限仍由角色派生。')
          : h(Fragment, null,
            h('p', { className: 'crew-dialog-lead' },
              `${importedTemplate.name} · ${importedTemplate.seats.length} 席${importedTemplate.description === '' ? '' : ` · ${importedTemplate.description}`}`),
            h('ul', { className: 'crew-brief' },
              importedTemplate.seats.map((seat, index) => h('li', { key: `template-${index}` },
                `${ROLE_LABEL[seat.role] ?? seat.role}「${seat.name}」${seat.engine === undefined ? '' : ` · ${seat.engine}`}`))),
            h('p', { className: 'crew-dialog-note' }, '模板不能提权；权限与写范围按角色校验。'),
            h('button', { type: 'button', className: 'crew-choice', onClick: useImportedTemplate }, '用这个模板'))),
      resume?.brief?.done?.length > 0
        ? h('div', { className: 'crew-q' },
          h('b', null, `上一轮 BRIEF · ${resume.name}`),
          h('ul', { className: 'crew-brief' },
            resume.brief.done.map((item, index) => h('li', { key: `resume-done-${index}` }, item.text))))
        : null,
      h('p', { className: 'crew-dialog-note' },
        resume === null
          ? '队长会先看目标和仓库，给你一个编制建议：几个人、什么职责、怎么验收。你只确认或改一下。工作目录可以是 git 仓库，也可以是普通目录；普通目录用复制隔离，不产生 commit。'
          : '交接包不含代码；填上一轮交付所在的本地仓库或目录。旧证据不会复制，新房间从当前内容重新开工。'))
    : step === 1
      ? h('div', { className: 'crew-dialog-body' },
        useProposal ? proposalBody : manualBody,
        ...verification,
        error ? h('p', { className: 'crew-dialog-note' }, error) : null)
      : h('div', { className: 'crew-dialog-body' },
        h('p', { className: 'crew-dialog-lead' }, '最后一眼：done、仓库、独立性。'),
        h('ul', { className: 'crew-brief' },
          h('li', null, `目标达成：${goal}`),
          h('li', null, custom
            ? `编制：自定义 · ${rosterName}`
            : `编制：${choices.find(item => item.id === templateId)?.name ?? '交付三人组'} · ${choices.find(item => item.id === templateId)?.seats ?? 3} 席`),
          h('li', null, verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：你逐段确认，不跑命令'),
          h('li', null, `仓库：${repoPath || '自动新建（~/CrewWorkspaces）'}`),
          resume === null ? null : h('li', null, `续做自：${resume.name}（只读记录）`),
          includeConstraints && constraints.trim() !== ''
            ? h('li', null, `项目约束：LODGE.md（${constraints.split('\n').filter(line => line.trim() !== '').length} 行）`)
            : null,
          h('li', null, '你不点「接受」，阶段不会算通过')),
        h('p', { className: 'crew-dialog-note' },
          verify === 'manual' && hasVerifier
            ? '人工验收模式不需要验收席位；要独立复核就补一条验收命令。'
            : hasVerifier
              ? '复核由验收席位执行；当前只有一台 CLI，验收卡会标「独立性降级」；第二引擎在 M4 接入。'
              : '这个房间没有独立验收席位：完成后由你凭证据签字。'),
        error ? h('p', { className: 'crew-dialog-note' }, error) : null)

  return h('div', { className: 'crew-overlay', onClick: onClose },
    h('div', { className: 'crew-dialog', onClick: event => event.stopPropagation() },
      h('div', { className: 'crew-dialog-head' },
        h('h2', null, resume === null ? '建队' : '基于交接记录续做'),
        h('button', { type: 'button', className: 'crew-ghost', onClick: onClose }, '关闭')),
      h('div', { className: 'crew-steps' },
        ['目标', '编制', '确认'].map((label, index) => h('span', {
          key: label,
          className: 'crew-step',
          'data-on': index === step,
        }, `${index + 1} ${label}`))),
      body,
      h('div', { className: 'crew-dialog-foot' },
        step > 0 ? h('button', { type: 'button', className: 'crew-ghost', onClick: () => setStep(step - 1) }, '上一步') : null,
        step === 0
          ? h(Fragment, null,
            h('button', { type: 'button', className: 'crew-ghost', onClick: chooseManual }, '手动选编制'),
            h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: goal.trim() === '' || needRepo || recommending,
              onClick: () => void recommend(),
            }, recommending ? '队长在看目标…' : '让队长看目标'))
          : step === 1
            ? h(Fragment, null,
              useProposal
                ? h('button', { type: 'button', className: 'crew-ghost', onClick: chooseManual }, '改一下')
                : null,
              useProposal
                ? h('button', {
                  type: 'button',
                  className: 'crew-accept',
                  disabled: busy || needRepo || (verify === 'manual' && hasVerifier) || (verify === 'test' && acceptance.trim() === ''),
                  onClick: () => void start(),
                }, busy ? '正在建真实房间…' : '按方案开工')
                : h('button', {
                  type: 'button',
                  className: 'crew-accept',
                  disabled: verify === 'test' && acceptance.trim() === '',
                  onClick: () => setStep(2),
                }, '下一步'))
            : h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: busy || needRepo || (verify === 'manual' && hasVerifier),
              onClick: () => void start(),
            }, busy ? '正在建真实房间…' : '开始'))))
}

export function App() {
  const store = useMemo(createStore, [])
  const state = useStore(store)
  const [dialog, setDialog] = useState(false)
  const [resume, setResume] = useState(null)
  const openDialog = room => {
    setResume(room ?? null)
    setDialog(true)
  }
  const closeDialog = () => {
    setDialog(false)
    setResume(null)
  }

  useEffect(() => {
    store.start()
    return () => store.disconnect()
  }, [store])

  if (state.rooms.length === 0) {
    return h('div', { className: 'crew-onboarding' },
      h('div', { className: 'crew-onboarding-card' },
        h(BotMark, { size: 44 }),
        h('h1', null, 'Lodge'),
        h('p', null, '开间专属任务房，养一支 AI 小队——你下班，它上班。'),
        h('button', {
          type: 'button',
          className: 'crew-accept',
          disabled: state.phase === 'loading' || state.phase === 'error',
          onClick: () => openDialog(),
        }, '开一个房间'),
        h(ImportButton, { className: 'crew-ghost', onFile: file => store.importHandoffFile(file) }, '打开交接记录'),
        state.runtime?.ok === false ? h('p', { className: 'crew-dialog-note' }, `基座未连接：${state.runtime.error}`) : null,
        state.phase === 'error' ? h('p', { className: 'crew-dialog-note' }, `连接失败：${state.error}`) : null,
        state.error ? h('p', { className: 'crew-dialog-note' }, state.error) : null),
      h(NewRoomDialog, {
        open: dialog,
        onClose: closeDialog,
        templates: state.templates ?? [],
        resume,
        onCreate: (goal, answers) => store.createRoom(goal, answers),
        onRecommend: (goal, repoPath) => store.recommendRoster(goal, repoPath),
        onProjectConstraints: repoPath => store.loadProjectConstraints(repoPath),
        onParseTemplate: (filename, text) => store.parseTemplate(filename, text),
      }))
  }

  const room = state.rooms.find(item => item.id === state.activeId) ?? null
  const isUsage = state.activeId === 'usage'
  const isDispatch = !isUsage && (state.activeId === 'dispatch' || room === null)

  return h('div', { className: 'dsb-frame' },
    h(Sidebar, {
      state,
      onSelect: id => store.select(id),
      onNew: () => openDialog(),
      onImport: file => store.importHandoffFile(file),
    }),
    isUsage
      ? h(UsageView, { state, store })
      : isDispatch
        ? h(DispatchView, { state, store })
        : h(RoomView, { state, room, store, onContinue: openDialog }),
    h(NewRoomDialog, {
      open: dialog,
      onClose: closeDialog,
      templates: state.templates ?? [],
      resume,
      onCreate: (goal, answers) => store.createRoom(goal, answers),
      onRecommend: (goal, repoPath) => store.recommendRoster(goal, repoPath),
      onProjectConstraints: repoPath => store.loadProjectConstraints(repoPath),
      onParseTemplate: (filename, text) => store.parseTemplate(filename, text),
    }))
}
