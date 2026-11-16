import { resolveRoomType } from './room-types/index.js'

const doneOf = line => {
  const text = String(line ?? '').trim()
  const checked = /^[-*]\s*\[( |x)\]\s*(.*)$/i.exec(text)
  if (checked) return { done: checked[1].toLowerCase() === 'x', text: checked[2].trim() }
  return { done: false, text: text.replace(/^[-*]\s*/, '') }
}

// Brief 是房间状态的投影，不是第二份真相；人改目标就改房间，不再维护 BRIEF.md。
export const briefOf = room => {
  const plan = room.plan ?? null
  const done = Array.isArray(plan?.done) && plan.done.length > 0
    ? plan.done.map(item => (typeof item === 'string'
      ? { done: false, text: item }
      : { done: item?.done === true, text: item?.text ?? '' }))
    : (resolveRoomType(room.roomType)?.briefDone?.(room, plan) ?? []).map(doneOf)
  const confirmed = (plan?.answers ?? []).map(item => `已确认：${item.question} → ${item.answer}`)
  const constraints = [...new Set([
    ...confirmed,
    ...(plan?.why ? [`编制理由：${plan.why}`] : []),
    ...(room.constraints ?? []),
    '决策型阶段必须由人点过，不能由模型代点',
    '交付型阶段必须在本阶段有证据落盘（证据在 evidence/，与 transcript 同一份真相）',
    ...(room.verifiers?.length > 0
      ? ['验收由验收员独立复核，最终由你签字']
      : ['验收由你凭证据签字']),
  ])]
  return {
    objective: room.goal,
    done,
    constraints,
  }
}
