// webhook 入口：外部事件按房间令牌投进来，当作一条外部消息，并按房间类型决定要不要叫醒成员。
// 令牌只存房间上，能随时轮换/关闭；没开 webhook 的房间一律 404。
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { webhookPathOf as pathOf } from '../../shared/webhook.js'

export const newWebhookToken = () => randomBytes(24).toString('hex')

const sameToken = (expected, given) => {
  if (typeof expected !== 'string' || typeof given !== 'string') return false
  if (expected.length !== given.length || expected.length === 0) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(given))
  } catch {
    return false
  }
}

export const verifyWebhookToken = (room, token) => sameToken(room?.webhook?.token, token)

export const webhookPathOf = room => pathOf(room?.id, room?.webhook?.token)

// 外部只交一句话和一个幂等 id；别的字段不接，长度封顶，避免一条 webhook 把房间撑爆。
export const normalizeWebhookEvent = body => {
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (text === '') return { error: '事件正文不能为空' }
  if (Array.from(text).length > 4000) return { error: '事件正文最多 4000 字' }
  const rawId = typeof body?.id === 'string' ? body.id.trim() : ''
  if (rawId !== '' && Array.from(rawId).length > 200) return { error: '事件 id 最多 200 字' }
  return { text, id: rawId === '' ? randomUUID() : rawId }
}

// 幂等：同一个 id 投两次只落一条。
export const alreadyReceived = (messages, id) => (
  id !== undefined && (messages ?? []).some(message => message?.meta?.webhookId === id)
)
