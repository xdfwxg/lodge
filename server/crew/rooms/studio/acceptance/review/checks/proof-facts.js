import { deliveryBlockersOf } from '../../acceptance.js'

// 交付自身的问题（证明没跑绿、缺证明、改动前也绿）由同一份验收契约判定；
// 这里只把它翻成给执行官看的话：PASS 直接改写成平台的拒收，走同一条返工路。
export const proofFactsCheck = ({ pending, judgment, proofRejectionOf }) => {
  if (judgment.decision !== 'pass') return null
  if (pending.facts === undefined) return null
  const blocker = deliveryBlockersOf({
    facts: pending.facts,
    requireProof: pending.requireProof === true,
    proofIsDeliverable: pending.proofIsDeliverable === true,
  }).find(item => item.code.startsWith('proof'))
  if (blocker === undefined) return null
  // 只有“证明跑不起来”这种硬问题在复核时直接改判；弱证明留给签收那一道门，
  // 复核把它当退回会把执行官送进一个补不动的循环（真房：连退三次同一份证明）。
  if (!['proof-failed', 'proof-missing'].includes(blocker.code)) return null
  return {
    replace: {
      ...judgment,
      decision: 'reject',
      reason: proofRejectionOf(pending),
      platformRejected: 'proof',
    },
  }
}
