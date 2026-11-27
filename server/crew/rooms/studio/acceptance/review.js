import { runCommandInPath } from '../delivery/proof-runner.js'
import { createReviewSession } from './review/session.js'
import { startReview } from './review/request.js'
import { consumeVerdict } from './review/verdict.js'

export { visualMatchesAudit, proofRejectionOf } from './review/verdict.js'
export { resumePausedForReviewPass } from './review/settle.js'

// 复核的对外入口：房间只看见 request / consume / fail / isBusy。
// 一轮复核的状态在 review/session.js，发起在 request.js，一票算不算数在 verdict.js，收口后去哪在 settle.js。
export const createReviewCoordinator = ({
  store,
  roomId,
  sendToMember,
  handoff = null,
  previews = null,
  attachments = null,
  advanceStage = null,
  runCommand = runCommandInPath,
}) => {
  const handoffTrigger = handoff?.trigger ?? (async ({ to, prompt, privateRoom }) => sendToMember(
    to,
    prompt,
    privateRoom === true ? { privateRoom: true } : {},
  ))
  // 盲评不能只写在提示词里：群聊里有执行官的过程话，复核信和催问都只进验收员自己的线程。
  const session = createReviewSession({
    store,
    roomId,
    deliver: (request, text) => sendToMember(request.verifier, text, {
      intent: 'review',
      ...(request.privateRoom === true ? { privateRoom: true } : {}),
    }),
  })

  return {
    request: stageIndex => startReview({
      store, roomId, session, stageIndex, handoffTrigger, previews, attachments,
    }),
    consume: params => consumeVerdict({
      store, roomId, session, runCommand, advanceStage, handoffTrigger, ...params,
    }),
    // 验收员这一回合没跑完（被停下、失败）：复核不能就这么挂着等人等到超时。
    fail: ({ memberId, reason = '' }) => {
      const pending = session.requestOf(memberId)
      if (pending === undefined || pending.expired === true) return false
      session.expire(pending, reason === '' ? '复核回合没有跑完；这一轮仍未通过。' : reason)
      return true
    },
    isBusy: () => session.isBusy(),
  }
}
