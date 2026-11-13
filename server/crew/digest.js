import { roomNeedsYou } from './attention.js'

export const createDigest = ({ readRoom, readRooms, readMessages }) => {
  const buildDigest = () => readRooms().map(room => {
    const messages = readMessages(room.id)
    const lastEvidence = [...messages].reverse().find(message => message.kind === 'evidence')
    const lastVerdict = [...messages].reverse().find(message => message.kind === 'verdict')
    const stages = Array.isArray(room.stages) ? room.stages : []
    const active = stages.findIndex(stage => stage.state === 'active')
    return {
      roomId: room.id,
      roomName: room.name,
      state: room.state,
      stage: active >= 0
        ? { index: active + 1, total: stages.length, title: stages[active].title, kind: stages[active].kind }
        : null,
      chat: room.chat === undefined ? null : { round: room.chat.round, phase: room.chat.phase, running: room.chat.running === true },
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
      : room.independence === 'human' ? '人签字验收（无独立复核）' : '独立性降级'
)

export const independencePolicyLabel = room => (
  room.independence === 'vendor'
    ? '跨厂商（执行与验收不同厂商）'
    : room.independence === 'model'
      ? '同家族（验收与执行同家族，复核强度低于跨厂商）'
      : room.independence === 'human'
        ? '无独立验收席位（你凭证据签字）'
        : room.independence === 'none' ? '单 CLI（验收与执行同引擎，独立性降级）' : '独立性未标注'
)

const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', '一个', '这个', '那个', '帮我', '把', '请', '需要', '怎么'])
const termsOf = text => {
  const value = String(text ?? '').toLowerCase()
  const words = value.match(/[a-z0-9_]{3,}/g) ?? []
  const chinese = value.match(/[一-鿿]{2,}/g) ?? []
  const grams = chinese.flatMap(run => {
    const out = []
    for (let index = 0; index < run.length - 1; index += 1) out.push(run.slice(index, index + 2))
    return out
  })
  return [...new Set([...words, ...grams])].filter(term => !STOP.has(term))
}

const roomText = room => [
  room.name,
  room.goal,
  room.brief?.objective,
  ...(room.brief?.done ?? []).map(item => (typeof item === 'string' ? item : item?.text)),
  ...(room.constraints ?? []),
  room.projectConstraints?.content,
].filter(value => typeof value === 'string').join(' ').toLowerCase()

// 本地语义路由：词项命中 + 房间状态，不调用模型，不把建议当执行。
export const suggestFor = (text, rooms) => {
  if (!Array.isArray(rooms) || rooms.length === 0) return null
  const terms = termsOf(text)
  const scored = rooms.map((room, index) => {
    const haystack = roomText(room)
    const matched = terms.filter(term => haystack.includes(term))
    const score = matched.length * 3
      + (terms.some(term => room.name.toLowerCase().includes(term)) ? 2 : 0)
      + (room.state === 'active' ? 1 : room.state === 'complete' ? -2 : 0)
      - index * 0.01
    return { room, matched, score }
  }).sort((a, b) => b.score - a.score)
  const best = scored[0]
  const room = best.score > 0 ? best.room : rooms.find(item => item.state === 'active') ?? rooms[0]
  return {
    roomId: room.id,
    roomName: room.name,
    seatId: 'planner',
    seatName: '队长',
    reason: best.score > 0
      ? `语义匹配：${best.matched.slice(0, 4).join('、')}`
      : '按最近活跃度选择进行中的群',
    permissions: '只读',
    stages: (room.stages ?? []).filter(stage => stage.state !== 'passed').length,
  }
}
