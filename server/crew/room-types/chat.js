import { roomTypeMeta } from '../../../shared/room-types.js'

const meta = roomTypeMeta('chat')

export const CHAT_TURNS_PER_ROUND = 6
export const MAX_CHAT_TURNS_PER_ROUND = 20

export const turnLimitOf = room => {
  const value = Number(room?.chat?.turnLimit)
  return Number.isInteger(value) && value >= 1 && value <= MAX_CHAT_TURNS_PER_ROUND
    ? value
    : CHAT_TURNS_PER_ROUND
}

const CN_DIGITS = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

const chineseNumber = raw => {
  if (raw === '十') return 10
  const match = raw.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/)
  if (match !== null) {
    return (match[1] === undefined ? 1 : CN_DIGITS[match[1]]) * 10
      + (match[2] === undefined ? 0 : CN_DIGITS[match[2]])
  }
  return CN_DIGITS[raw] ?? null
}

// 用户说“讨论三次/5轮/讨论一遍”时，次数是这一轮的业务参数，不让模型自己判断。
export const requestedTurnLimitOf = text => {
  const match = String(text ?? '').match(/(?:重新|再)?(?:讨论|聊|说|来)\s*(?:一遍|([一二两三四五六七八九十]+|\d+)\s*(?:次|轮|遍))/)
  if (match === null) return null
  const raw = match[1]
  if (raw === undefined) return 1
  const value = /^\d+$/.test(raw) ? Number(raw) : chineseNumber(raw)
  return Number.isInteger(value) && value >= 1
    ? Math.min(value, MAX_CHAT_TURNS_PER_ROUND)
    : null
}

export const id = 'chat'
export const name = meta.name
export const description = meta.description
export const defaultVerify = meta.defaultVerify
export const readOnly = meta.readOnly
export const defaultMembers = [
  { role: 'worker', name: '甲', personality: 'assertive' },
  { role: 'worker', name: '乙', personality: 'cheerful' },
  { role: 'worker', name: '丙', personality: 'gentle' },
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
