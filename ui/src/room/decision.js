import { createElement as h, useState } from 'react'
import { chatStudioSeed } from './chat-seed.js'

const nameOf = (room, seatId) => (
  room.seatSpecs?.find(seat => seat.id === seatId)?.name ??
  room.seatNames?.[seatId] ??
  seatId ??
  '席位'
)

const cleanText = value => String(value ?? '')
  .replace(/\*\*/g, '')
  .replace(/`/g, '')
  .replace(/^#+\s*/gm, '')
  .replace(/\s+/g, ' ')
  .trim()

const conclusionOf = room => {
  const message = [...(room.messages ?? [])].reverse().find(item => item.kind === 'chat_conclusion')
  return message === undefined ? null : message
}

const statusOfPaused = room => {
  if (room.pauseReason === 'seat_error') {
    const who = nameOf(room, room.seatError?.seat)
    const reason = room.seatError?.kind === 'quota'
      ? `${who}额度不足`
      : room.seatError?.kind === 'auth'
        ? `${who}登录失效`
        : room.seatError?.kind === 'rate_limit'
          ? `${who}被限流`
          : `${who}调用失败`
    return { title: `${reason}，等你处理`, tone: 'paused' }
  }
  if (room.pauseReason === 'budget') return { title: '预算已用尽，等你处理', tone: 'paused' }
  if (room.pauseReason === 'mcp') return { title: 'MCP 熔断，等你恢复', tone: 'paused' }
  if (room.pauseReason === 'approval') return { title: '外部动作审批超时，等你处理', tone: 'paused' }
  return { title: room.idle === true ? '已暂停，等你说话' : '已暂停', tone: 'paused' }
}

const stageLine = (room, stage) => (
  stage === undefined
    ? ''
    : `阶段 ${room.stages.findIndex(item => item.id === stage.id) + 1}/${room.stages.length} · ${stage.title}`
)

const evidenceLine = stage => {
  const evidence = stage?.evidence?.at(-1)
  if (evidence === undefined) return ''
  if (evidence.manual) return '产物已就绪 · 等待复核'
  return `${evidence.command} · exit ${evidence.exit === null ? '无' : evidence.exit}`
}

const verdictLine = stage => {
  if (stage?.verdict === null || stage?.verdict === undefined) return ''
  const text = cleanText(stage.verdict.text)
  return text.length > 220 ? `${text.slice(0, 220)}…` : text
}

// 主屏只回答：现在到哪了、卡在谁那里、要我做什么。
export const buildDecision = (room, view) => {
  const stages = view?.stages ?? []
  const stage = stages.find(item => item.state === 'active') ?? stages.at(-1) ?? null
  const stageIndex = stage === null ? -1 : stage.index
  const evidence = evidenceLine(stage)
  const verdict = verdictLine(stage)
  const verifierCount = room.verifiers?.length ?? 0
  const reviewLabel = room.needsYou?.label ?? ''

  if (room.state === 'complete') {
    if (room.roomType === 'chat') {
      const conclusion = conclusionOf(room)
      const text = cleanText(conclusion?.text)
      return {
        key: 'chat-complete',
        title: '聊天已结束',
        detail: text.length > 260 ? `${text.slice(0, 260)}…` : text,
        primary: null,
        secondary: { label: '查看完整记录', action: 'audit' },
        extra: { label: '用结论新建工作室', action: 'start-studio' },
      }
    }
    const files = room.delivery?.changedFiles?.length ?? 0
    return {
      key: 'complete',
      title: '这轮完成了',
      detail: `${stages.filter(item => item.state === 'passed').length} 个阶段 · ${files} 个文件 · 验收员通过`,
      primary: { label: '查看交付', action: 'delivery' },
      secondary: { label: '查看证据', action: 'evidence' },
      extra: { label: '导出交付单', action: 'export' },
    }
  }
  if (room.state === 'stopped') {
    return { key: 'stopped', title: '房间已停止', detail: '', primary: null, secondary: null }
  }
  if (room.state === 'paused') {
    const paused = statusOfPaused(room)
    return {
      key: 'paused',
      title: paused.title,
      detail: room.seatError?.kind === 'quota'
        ? '充值或给这个席位换一个模型后，点“继续”。'
        : '处理完成后点“继续”。',
      primary: { label: '继续', action: 'resume' },
      secondary: null,
    }
  }

  if (room.roomType === 'chat') {
    const chat = room.chat ?? {}
    if (chat.running === true) {
      return {
        key: 'chat-running',
        title: '讨论中',
        detail: '成员正在发言',
        primary: null,
        secondary: null,
      }
    }
    if (chat.phase === 'awaiting_decision') {
      const conclusion = conclusionOf(room)
      const text = cleanText(conclusion?.text)
      return {
        key: 'chat-decision',
        title: '讨论结束，等你确认结论',
        detail: text.length > 260 ? `${text.slice(0, 260)}…` : text,
        primary: { label: '确认结论', action: 'chat-accept' },
        secondary: { label: '再讨论', action: 'continue-chat' },
        extra: { label: '用结论新建工作室', action: 'start-studio' },
      }
    }
    return {
      key: 'chat-interrupted',
      title: '讨论中断，等你处理',
      detail: '上一轮讨论中断了，可以重新开始本轮。',
      primary: { label: '重新开始讨论', action: 'chat-resume' },
      secondary: { label: '审计详情', action: 'audit' },
    }
  }

  if (room.needsYou?.kind === 'signoff') {
    return {
      key: 'signoff',
      title: '验收通过，等你签字',
      detail: verdict || (verifierCount > 1 ? `${verifierCount} 位验收员都通过了` : '验收员已通过'),
      primary: { label: '签字通过', action: 'sign', stage: stageIndex },
      secondary: { label: '查看证据', action: 'evidence' },
    }
  }
  if (room.needsYou?.kind === 'rework') {
    return {
      key: 'rework',
      title: '验收退回，等你决定',
      detail: verdict || stage?.rework?.[0]?.text || '验收员退回了这一步，需要执行官重做。',
      primary: { label: '让执行官重做', action: 'rework', stage: stageIndex },
      secondary: { label: '查看证据', action: 'evidence' },
    }
  }
  if (room.needsYou?.kind === 'review') {
    const progress = /已回报/.test(reviewLabel) ? reviewLabel : ''
    return {
      key: 'review',
      title: '验收员正在独立复核',
      detail: [evidence || '证据已就绪', progress].filter(Boolean).join(' · '),
      secondary: { label: '查看证据', action: 'evidence' },
    }
  }
  if (room.needsYou?.kind === 'decision') {
    return {
      key: 'decision',
      title: '等你确认这一步',
      detail: stage?.acceptanceLabel ?? '这一步需要你拍板。',
      primary: { label: '确认这一步', action: 'sign', stage: stageIndex },
      secondary: { label: '查看详情', action: 'audit' },
    }
  }
  if (room.needsYou?.kind === 'setup') {
    return {
      key: 'setup',
      title: '还差一条验收命令',
      detail: '设置后，执行官完成时系统才能自动验收。',
      primary: { label: '去设置', action: 'audit' },
      secondary: null,
    }
  }
  if (room.needsYou?.kind === 'merge') {
    return {
      key: 'merge',
      title: '有改动冲突，等你处理',
      detail: (stage?.conflict?.files ?? []).join('、') || '合并时需要你选一边。',
      primary: { label: '查看冲突', action: 'audit' },
      secondary: null,
    }
  }
  if (room.needsYou !== null && room.needsYou !== undefined) {
    return {
      key: 'attention',
      title: room.needsYou.label,
      detail: evidence || verdict,
      primary: null,
      secondary: { label: '查看详情', action: 'audit' },
    }
  }

  const workingTask = stage?.tasks?.find(task => task.status === 'working')
  const busySeat = (Array.isArray(room.busySeats) ? room.busySeats[0] : room.busySeat) ?? workingTask?.owner
  return {
    key: 'executing',
    title: busySeat === undefined ? '执行中' : `${nameOf(room, busySeat)} 正在处理`,
    detail: stage === null ? '等待下一步' : `${stage.title} · ${stage.acceptanceLabel}`,
    primary: null,
    secondary: { label: '审计详情', action: 'audit' },
  }
}

export function RoomStatusHeader({ room, decision, onAudit, actions = {} }) {
  const more = [
    room.state === 'active' && actions.pause
      ? { key: 'pause', label: '暂停', run: actions.pause }
      : null,
    room.state === 'paused' && actions.resume
      ? { key: 'resume', label: '继续', run: actions.resume }
      : null,
    ['active', 'paused'].includes(room.state) && actions.stop
      ? { key: 'stop', label: '停止', run: actions.stop }
      : null,
    actions.continue ? { key: 'continue', label: '基于此记录续做', run: actions.continue } : null,
    actions.review ? { key: 'review', label: '复盘', run: actions.review } : null,
  ].filter(Boolean)
  const showActions = typeof onAudit === 'function' || more.length > 0
  return h('header', { className: 'crew-decision-head' },
    h('div', { className: 'crew-decision-heading' },
      h('h1', { title: room.goal }, room.name),
      h('p', { className: 'crew-decision-state', 'data-tone': decision.tone }, decision.title)),
    showActions
      ? h('div', { className: 'crew-decision-head-actions' },
        typeof onAudit === 'function'
          ? h('button', { type: 'button', className: 'crew-ghost', onClick: onAudit }, '审计详情')
          : null,
        more.length > 0
          ? h('details', { className: 'crew-decision-more' },
            h('summary', { 'aria-label': '更多操作' }, '⋯'),
            h('div', { className: 'crew-decision-menu' },
              more.map(item => h('button', { key: item.key, type: 'button', onClick: item.run }, item.label))))
          : null)
      : null)
}

// 执行中、工作室已完成、聊天讨论/出结论时都不需要单独占一块卡：
// 阶段线、交付单、结论卡、打字行已经说明了状态。
export const showsDecisionCard = decision => (
  decision?.key !== 'executing'
  && decision?.key !== 'complete'
  && decision?.key !== 'chat-running'
  && decision?.key !== 'chat-decision'
  && decision?.key !== 'chat-complete'
)

export function DecisionCard({ room, decision, onAction }) {
  const [reworkOpen, setReworkOpen] = useState(false)
  const [note, setNote] = useState('')
  const primary = decision.primary
  const secondary = decision.secondary
  const extra = decision.extra
  const conclusion = conclusionOf(room)
  const primaryAction = () => {
    if (primary === null || primary === undefined) return
    if (primary.action === 'rework') {
      setReworkOpen(true)
      return
    }
    onAction(primary.action, primary.stage)
  }
  if (!showsDecisionCard(decision)) return null
  return h('section', { className: 'crew-decision-card', 'data-kind': decision.key },
    room.roomType === 'chat'
      ? h('div', { className: 'crew-decision-card-kicker' }, '聊天室')
      : null,
    h('h2', null, decision.title),
    decision.detail === '' ? null : h('p', { className: 'crew-decision-detail' }, decision.detail),
    reworkOpen
      ? h('div', { className: 'crew-decision-rework' },
        h('textarea', {
          value: note,
          rows: 3,
          placeholder: '告诉执行官哪里不对，例如：测试没有覆盖空字符串。',
          onChange: event => setNote(event.target.value),
        }),
        h('div', { className: 'crew-decision-rework-actions' },
          h('button', { type: 'button', className: 'crew-ghost', onClick: () => setReworkOpen(false) }, '取消'),
          h('button', {
            type: 'button',
            className: 'crew-decision-primary',
            onClick: () => onAction('rework-submit', primary.stage, note.trim()),
          }, '确认重做')))
      : null,
    h('div', { className: 'crew-decision-actions' },
      primary === null || primary === undefined ? null : h('button', {
        type: 'button',
        className: 'crew-decision-primary',
        onClick: primaryAction,
      }, primary.label),
      secondary === null || secondary === undefined ? null : h('button', {
        type: 'button',
        className: 'crew-decision-secondary',
        onClick: () => onAction(secondary.action),
      }, secondary.label),
      extra === null || extra === undefined ? null : h('button', {
        type: 'button',
        className: 'crew-decision-secondary',
        onClick: () => onAction(
          extra.action,
          extra.action === 'start-studio'
            ? chatStudioSeed({ room, conclusion: conclusion?.text ?? '' })
            : undefined,
        ),
      }, extra.label)))
}
