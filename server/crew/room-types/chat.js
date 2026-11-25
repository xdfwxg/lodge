import { roomTypeMeta } from '../../../shared/room-types.js'
import { DEFAULT_CHAT_MEMBERS } from '../../../shared/chat-defaults.js'
import { CHAT_PHASE, STAGE_STATE } from '../../../shared/states.js'

const meta = roomTypeMeta('chat')

// 一轮最多 4 位开口；少请人也照样说得完，人数由主持人按话题决定。
export const CHAT_TURNS_PER_ROUND = 4

// 房间可以调低一轮的上限，但不会超过“每轮最多 4 位”。
export const turnLimitOf = room => {
  const value = Number(room?.chat?.turnLimit)
  return Number.isInteger(value) && value >= 1 && value <= CHAT_TURNS_PER_ROUND
    ? value
    : CHAT_TURNS_PER_ROUND
}

// 新建聊天室和 Lodge 的初始对话状态只写一次，避免两处字段漂移。
export const initialChatState = () => ({
  round: 1,
  phase: CHAT_PHASE.discussing,
  turnLimit: CHAT_TURNS_PER_ROUND,
  turns: 0,
  conclusionId: null,
  castIds: null,
  castFocus: {},
  opening: '',
  mutedIds: [],
  running: false,
  speaker: '',
  note: '',
})

export const id = 'chat'
export const name = meta.name
export const description = meta.description
export const defaultVerify = meta.defaultVerify
export const readOnly = meta.readOnly
export const defaultMembers = DEFAULT_CHAT_MEMBERS
export const autoStart = 'chat'
export const singleDirectory = true
export const requireWorker = false

// 能力矩阵来自 shared/room-types.js 的产品级房型清单。
export const capabilities = meta.capabilities

export const normalize = () => ({})

export const briefDone = () => ['- [ ] 围绕话题完成讨论，并由你确认结论']

export const buildStages = () => ({
  stages: [
    { title: '聊天讨论', kind: 'decision', state: STAGE_STATE.active, readOnly: true },
    { title: '结论', kind: 'decision', state: STAGE_STATE.pending, dependsOn: [0], readOnly: true },
  ],
  messages: ['聊天室：先聊，到发言上限后系统收结论，最后由你定。'],
})
