import { createElement as h, useState } from 'react'
import { buildIdleDecision, cleanText, nameOf } from '../decision.js'

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

// 工作室只关心：阶段推进、验收、返工、签字和交付。
export const buildStudioDecision = (room, view) => {
  const idle = buildIdleDecision(room)
  if (idle !== null) return idle
  const stages = view?.stages ?? []
  const stage = stages.find(item => item.state === 'active') ?? stages.at(-1) ?? null
  const stageIndex = stage === null ? -1 : stage.index
  const evidence = evidenceLine(stage)
  const verdict = verdictLine(stage)
  const verifierCount = room.verifiers?.length ?? 0
  const reviewLabel = room.needsYou?.label ?? ''

  if (room.state === 'complete') {
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

// 执行中、已完成不单独占一块卡：阶段线和交付单已经说明了状态。
export const showsDecisionCard = decision => (
  decision?.key !== 'executing'
  && decision?.key !== 'complete'
)

// 执行中只留一条状态行：谁在做、做到哪一段；过程不再写进时间线。
export const studioActivityLine = (room, view) => {
  if (room?.state !== 'active') return ''
  // 基座已经保证一次只跑一个回合；有席位排队时把“谁在跑、谁在等”放在一行。
  const presence = Array.isArray(room.presence) ? room.presence : []
  const waiting = presence.filter(item => item.state === 'queued').map(item => nameOf(room, item.seatId)).filter(Boolean)
  if (waiting.length > 0) {
    const working = presence
      .filter(item => item.state === 'working')
      .map(item => nameOf(room, item.seatId))
      .filter(Boolean)
    return [
      working.length > 0 ? `${working.join('、')} 正在处理` : '',
      `${waiting.join('、')} 排队中`,
    ].filter(Boolean).join(' · ')
  }
  const stage = view?.stages?.find(item => item.state === 'active') ?? null
  const where = stage === null ? '' : ` · 阶段 ${stage.index + 1}「${stage.title}」`
  if (room.needsYou?.kind === 'review') {
    const names = (room.verifiers ?? []).map(id => nameOf(room, id)).filter(Boolean).join('、')
    return `${names === '' ? '验收员' : names} 正在独立复核${where}`
  }
  const working = stage?.tasks?.find(task => task.status === 'working')
  const busySeat = (Array.isArray(room.busySeats) ? room.busySeats[0] : room.busySeat) ?? working?.owner
  if (busySeat === undefined || busySeat === null) return ''
  const seat = room.seatSpecs?.find(item => item.id === busySeat)
  const verb = seat?.role === 'lead' ? '正在编排' : seat?.role === 'verifier' ? '正在复核' : '正在处理'
  return `${nameOf(room, busySeat)} ${verb}${where}`
}

export function StudioDecisionCard({ decision, onAction }) {
  const [reworkOpen, setReworkOpen] = useState(false)
  const [note, setNote] = useState('')
  const primary = decision.primary
  const secondary = decision.secondary
  const extra = decision.extra
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
        onClick: () => onAction(extra.action),
      }, extra.label)))
}
