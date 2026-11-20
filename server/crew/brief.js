import { resolveRoomType } from './rooms/kinds.js'

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
  // 产品规则由引擎执行；这里只放人做过的决定，不把内部机制当“约束”展示。
  const constraints = [...new Set((plan?.answers ?? []).map(item => `已确认：${item.question} → ${item.answer}`))]
  return {
    objective: room.goal,
    done,
    constraints,
  }
}
