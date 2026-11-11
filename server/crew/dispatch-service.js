import { randomUUID } from 'node:crypto'
import { suggestFor } from './digest.js'
import { created, fail, ok } from './result.js'

// 调度台：只建议、人确认；确认前目标房间零动静。
export const createDispatchService = ({ store, emit, dispatchPayload }) => {
  const { readRoom, readRooms, updateRoom, appendMessage, appendEvent } = store

  const request = async (requestId, action, { method, readBody = async () => ({}) }) => {
    if (requestId === undefined && method === 'POST') {
      const body = await readBody()
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text === '' || text.length > 2000) return fail('invalid', '请求不能为空，且不超过 2000 字')
      const suggestion = suggestFor(text, readRooms())
      if (suggestion === null) return fail('conflict', '还没有房间可以派活；先开一个房间')
      const entry = {
        id: `req-${randomUUID().slice(0, 8)}`,
        text,
        state: 'suggested',
        at: Date.now(),
        suggestion,
      }
      const updated = updateRoom('dispatch', current => {
        current.requests.push(entry)
        return { events: [{ type: 'dispatch.requested', payload: { requestId: entry.id, text } }] }
      })
      if (updated === null) return fail('not_found', '没有调度台')
      const payload = dispatchPayload()
      emit('dispatch', payload)
      return created({ request: entry, dispatch: payload })
    }

    let rejection = null
    let decided = null
    const updated = updateRoom('dispatch', current => {
      const target = current.requests.find(item => item.id === requestId)
      if (target === undefined) { rejection = ['not_found', '没有这条请求']; return null }
      if (target.state !== 'suggested') { rejection = ['conflict', '这条请求已经处理过了']; return null }

      if (action === 'confirm' && method === 'POST') {
        if (readRoom(target.suggestion.roomId) === null) {
          rejection = ['conflict', '目标房间不在了']
          return null
        }
        target.state = 'confirmed'
        target.decidedAt = Date.now()
        decided = target
        return { events: [{ type: 'dispatch.confirmed', payload: { requestId: target.id, roomId: target.suggestion.roomId } }] }
      }

      if (action === 'decline' && method === 'POST') {
        target.state = 'declined'
        target.decidedAt = Date.now()
        decided = target
        return { events: [{ type: 'dispatch.declined', payload: { requestId: target.id } }] }
      }

      rejection = ['method', '方法不对']
      return null
    })

    if (rejection !== null) return fail(rejection[0], rejection[1])
    if (updated === null || decided === null) return fail('not_found', '没有这条请求')

    emit('dispatch', dispatchPayload())
    if (decided.state === 'confirmed') {
      appendMessage(decided.suggestion.roomId, {
        kind: 'system',
        text: `调度台派来一项任务 · 来源请求：「${decided.text}」· 已按你的确认交给本群`,
      })
      appendEvent(decided.suggestion.roomId, 'dispatch.received', { requestId: decided.id })
    }
    return ok({ request: decided })
  }

  return { request }
}
