import { transitionAssignment } from '../../../../assignments.js'

// 一轮复核的生命周期：谁在看、什么时候算停、超时怎么收尾。
// 发起（request.js）、一票算不算数（verdict.js）、一轮结束后去哪（settle.js）都只通过这一份状态说话；
// 房间的复核状态只有这里可写，别处只读。
export const createReviewSession = ({ store, roomId, deliver }) => {
  let round = null
  const stale = new Set()

  const waiting = () => [...(round?.requests.values() ?? [])].filter(request => request.expired !== true)
  const isCurrent = target => round !== null && round === target
  const requestOf = memberId => round?.requests.get(memberId)
  const clearTimers = request => {
    clearTimeout(request.timer)
    clearTimeout(request.reminder)
  }

  // 一拍复核的终态：到时间，或者验收员交了无效判定。
  // 每位验收员各自收尾；最后一位收尾时把整轮为什么结束说清楚。
  const expire = (request, text, reason = 'timeout') => {
    if (request === undefined || request === null || request.expired === true) return false
    if (requestOf(request.verifier) !== request) return false
    request.expired = true
    clearTimers(request)
    // 超时也是这一拍复核的终态；否则它会一直挂在 sent，最后挡住交付。
    if (request.assignment !== null && request.assignment !== undefined &&
      ['sent', 'working'].includes(request.assignment.status)) {
      transitionAssignment(store, request.assignment.id, 'failed', { resultText: '复核超时，没有收到验收结论' })
    }
    store.appendEvent(roomId, 'review.timeout', { stage: request.stage, verifier: request.verifier })
    store.appendMessage(roomId, { kind: 'system', text })
    // 同一位验收员只记一次：重开复核再超时，不能在状态里写两遍名字。
    round.timedOut = (round.timedOut ?? []).includes(request.verifier)
      ? round.timedOut
      : [...(round.timedOut ?? []), request.verifier]
    // 不是每次结束都因为“到时间”：验收员交了无效判定也算一次结束，说清是哪种。
    round.finishReason = round.finishReason ?? reason
    if (waiting().length === 0) {
      round.finished = true
      const invalid = round.finishReason === 'invalid'
      store.appendMessage(roomId, {
        kind: 'system',
        text: invalid
          ? `这次复核没有拿到有效结论：${round.passed}/${round.total} 位验收员通过。可以再叫一次复核，或退回重做。`
          : `这次复核到时间了：${round.passed}/${round.total} 位验收员通过；其余未回报，不能确认。可以重新发起复核。`,
        meta: { kind: 'review_timeout', stage: round.stage, verifiers: round.timedOut, reason: round.finishReason },
      })
    }
    return true
  }

  return {
    current: () => round,
    isCurrent,
    requestOf,
    waiting,
    isBusy: () => waiting().length > 0,
    begin: next => { round = next },
    end: () => { round = null },
    clearTimers,
    expire,
    deliver: (request, text) => deliver(request, text),
    // 证据换了、或房间重新发起：旧回合的结论不再算数，连交接一起放下。
    dropRound: () => {
      if (round === null) return
      for (const [memberId, request] of round.requests) {
        clearTimers(request)
        stale.add(memberId)
      }
      round = null
    },
    takeStale: memberId => {
      if (!stale.has(memberId)) return false
      stale.delete(memberId)
      return true
    },
  }
}
