import { roomTypeMeta } from '../../../shared/room-types.js'

const meta = roomTypeMeta('chat')

export const CHAT_TURNS_PER_ROUND = 6
export const MAX_CHAT_TURNS_PER_ROUND = 20
export const maxChatTurns = MAX_CHAT_TURNS_PER_ROUND

export const turnLimitOf = room => {
  const value = Number(room?.chat?.turnLimit)
  return Number.isInteger(value) && value >= 1 && value <= MAX_CHAT_TURNS_PER_ROUND
    ? value
    : CHAT_TURNS_PER_ROUND
}

export const id = 'chat'
export const name = meta.name
export const description = meta.description
export const defaultVerify = meta.defaultVerify
export const readOnly = meta.readOnly
export const defaultMembers = [
  { role: 'worker', name: '甲', personality: 'assertive', stance: 'proposer' },
  { role: 'worker', name: '乙', personality: 'cheerful', stance: 'critic' },
  { role: 'worker', name: '丙', personality: 'gentle', stance: 'synthesizer' },
]
export const autoStart = 'chat'
export const singleDirectory = true
export const requireWorker = false

// 能力矩阵来自 shared/room-types.js 的产品级房型清单。
export const capabilities = meta.capabilities

export const normalize = () => ({ verify: 'manual', acceptance: '' })

export const briefDone = () => ['- [ ] 围绕话题完成讨论，并由你确认结论']

export const buildStages = () => ({
  stages: [
    { title: '聊天讨论', kind: 'decision', state: 'active', readOnly: true },
    { title: '结论', kind: 'decision', state: 'pending', dependsOn: [0], readOnly: true },
  ],
  messages: ['聊天室：先聊，到发言上限后主持人收结论，最后由你定。'],
})
