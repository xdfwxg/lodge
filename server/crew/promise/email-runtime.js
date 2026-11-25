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
    if (updated !== null) {
      notice(store, room.id, `已发到 ${to}`)
      emit('room', updated)
    } else {
      // 邮件已经发出去了，这个事实不能因为承诺同时被改过就丢掉。
      store.appendEvent?.(room.id, 'promise.emailed', {
        roundId: payload.roundId ?? null,
        to,
        versionChanged: true,
      })
      notice(store, room.id, `已发到 ${to}；承诺同时被改过，这次投递没有写回旧设置。`)
    }
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
    if (updated !== null) {
      notice(store, room.id, `邮件没发出去：${error?.message ?? '先检查邮箱设置'}`)
      emit('room', updated)
    } else {
      store.appendEvent?.(room.id, 'promise.email_failed', {
        roundId: payload.roundId ?? null,
        to,
        versionChanged: true,
      })
      notice(store, room.id, `邮件没发出去：${error?.message ?? '先检查邮箱设置'}；承诺同时被改过，这次结果没有写回旧设置。`)
    }
    return true
  }
}
