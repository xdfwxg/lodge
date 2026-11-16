import { nameOf } from '../decision.js'

// 执行中只留一条状态行：谁在做、做到哪一段；过程不再写进时间线。
export const studioActivityLine = (room, view) => {
  if (room?.state !== 'active') return ''
  // 基座已经保证一次只跑一个回合；有成员排队时把“谁在跑、谁在等”放在一行。
  const presence = Array.isArray(room.presence) ? room.presence : []
  const waiting = presence.filter(item => item.state === 'queued').map(item => nameOf(room, item.memberId)).filter(Boolean)
  if (waiting.length > 0) {
    const working = presence
      .filter(item => item.state === 'working')
      .map(item => nameOf(room, item.memberId))
      .filter(Boolean)
    return [
      working.length > 0 ? `${working.join('、')} 正在处理` : '',
      `${waiting.join('、')} 排队中`,
    ].filter(Boolean).join(' · ')
  }
  const stage = view?.stages?.find(item => item.state === 'active') ?? null
  const where = stage === null ? '' : ` · 第 ${stage.index + 1} 步「${stage.title}」`
  if (room.needsYou?.kind === 'review') {
    const names = (room.verifiers ?? []).map(id => nameOf(room, id)).filter(Boolean).join('、')
    const who = names === '' ? '验收员' : names
    const label = room.independence === 'vendor'
      ? '正在独立复核'
      : room.independence === 'model' ? '正在复核；同一家模型，独立性有限' : '正在复核'
    return `${who} ${label}${where}`
  }
  const working = stage?.tasks?.find(task => task.status === 'working')
  const busyMember = (Array.isArray(room.busyMembers) ? room.busyMembers[0] : room.busyMember) ?? working?.owner
  if (busyMember === undefined || busyMember === null) return ''
  const member = room.members?.find(item => item.id === busyMember)
  const verb = member?.role === 'lead' ? '正在安排' : member?.role === 'verifier' ? '正在复核' : '正在处理'
  return `${nameOf(room, busyMember)} ${verb}${where}`
}
