import { emailReady, sendEmail } from '../delivery/email.js'
import { promiseOf } from './contract.js'

const notice = (store, roomId, text) => store.appendMessage?.(roomId, {
  kind: 'system',
  text,
  meta: { kind: 'notice', show: true },
})

// 投递是平台动作：同一轮只排一次，成功或最终失败都记在承诺上。
export const createEmailRunner = ({
  store,
  emit,
  send = sendEmail,
  ready = emailReady,
}) => async event => {
  const room = store.readRoom(event.roomId)
  if (room === null) return true
  const promise = promiseOf(room)
  if (promise === null || promise.delivery?.channel !== 'email') return true
  if (promise.status !== 'active') return true
  if (ready() !== true) {
    notice(store, room.id, '邮箱还没接上；这一期没有发出去。')
    return true
  }
  const payload = event.payload ?? {}
  const to = String(payload.to || promise.delivery.to || '').trim()
  if (to === '' || String(payload.text ?? '').trim() === '') {
    notice(store, room.id, '这一期没有可发的正文；邮件没有发出去。')
    return true
  }
  try {
    const sent = await send({ to, subject: payload.subject, text: payload.text })
    const updated = store.updateRoom(room.id, current => {
      if (current.promise?.version !== promise.version) return null
      current.promise = {
        ...current.promise,
        lastEmailAt: Date.now(),
        lastEmailStatus: 'sent',
        lastEmailTo: to,
        lastEmailId: sent?.id ?? '',
        version: promise.version + 1,
      }
      return { events: [{ type: 'promise.emailed', payload: { roundId: payload.roundId ?? null, to } }] }
    })
    notice(store, room.id, `已发到 ${to}`)
    if (updated !== null) emit('room', updated)
    return true
  } catch (error) {
    if (Number(event.attempts ?? 1) < Number(event.maxAttempts ?? 3)) throw error
    const updated = store.updateRoom(room.id, current => {
      if (current.promise?.version !== promise.version) return null
      current.promise = {
        ...current.promise,
        lastEmailAt: Date.now(),
        lastEmailStatus: 'failed',
        lastEmailTo: to,
        lastEmailError: String(error?.message ?? error).slice(0, 300),
        version: promise.version + 1,
      }
      return { events: [{ type: 'promise.email_failed', payload: { roundId: payload.roundId ?? null } }] }
    })
    notice(store, room.id, `邮件没发出去：${error?.message ?? '先检查邮箱设置'}`)
    if (updated !== null) emit('room', updated)
    return true
  }
}
