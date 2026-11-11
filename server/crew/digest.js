import { roomNeedsYou } from './attention.js'

export const createDigest = ({ readRoom, readRooms, readMessages }) => {
  const buildDigest = () => readRooms().map(room => {
    const messages = readMessages(room.id)
    const lastEvidence = [...messages].reverse().find(message => message.kind === 'evidence')
    const lastVerdict = [...messages].reverse().find(message => message.kind === 'verdict')
    const active = room.stages.findIndex(stage => stage.state === 'active')
    return {
      roomId: room.id,
      roomName: room.name,
      state: room.state,
      stage: active >= 0
        ? { index: active + 1, total: room.stages.length, title: room.stages[active].title, kind: room.stages[active].kind }
        : null,
      evidence: lastEvidence ? { command: lastEvidence.meta.command, exit: lastEvidence.meta.exit } : null,
      verdict: lastVerdict ? { pass: lastVerdict.meta.pass === true } : null,
      openQuestion: room.openQuestion ?? null,
      needsYou: roomNeedsYou(room, messages),
    }
  })

  const dispatchPayload = () => ({ ...readRoom('dispatch'), digest: buildDigest() })

  return { buildDigest, dispatchPayload }
}

export const independenceLabel = room => (
  room.independence === 'vendor'
    ? '跨厂商复核'
    : room.independence === 'model'
      ? '同家族复核'
      : room.independence === 'solo'
        ? '单人 · 人签字'
        : room.independence === 'human' ? '人签字验收（无独立复核）' : '独立性降级'
)

export const suggestFor = (text, rooms) => {
  if (!Array.isArray(rooms) || rooms.length === 0) return null
  const keywordRoom = /README|文档/i.test(text)
    ? rooms.find(room => /README/i.test(room.name))
    : /登录|OAuth|认证|auth/i.test(text)
      ? rooms.find(room => /OAuth/i.test(room.name))
      : null
  const room = keywordRoom ?? rooms.find(item => item.state === 'active') ?? rooms[0]
  return {
    roomId: room.id,
    roomName: room.name,
    seatId: 'planner',
    seatName: '队长',
    reason: keywordRoom ? '关键词命中已有群的目标' : '按最近活跃度选择进行中的群',
    permissions: '只读',
    stages: room.stages.filter(stage => stage.state !== 'passed').length,
  }
}
