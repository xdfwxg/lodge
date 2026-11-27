// 交付是否可验收：平台对「交付本身」能说的全部事实，只在这里定义一次。
//
// 复核（review.js）拿它决定要不要提前退回，签收（gates.js）拿它做最后一道门；
// 两处都只负责把 blocker 翻成给人看的一句话，不各自再判断一遍。
// 加一条规则只改这里，别在调用方补一个 if。
import { verdictPassed } from '../../../../../shared/judgment.js'
import { resultEvidenceFor, reviewState } from './verifiers.js'
import { verifierIds } from '../../../room-members.js'
import { PROOF_DIR, PROOF_FILE } from '../../../../../shared/proof.js'
import { REVIEW_STATE } from '../../../../../shared/states.js'

const listOf = value => (Array.isArray(value) ? value : [])

const proofOf = proof => {
  // 没有证明记录（老房间、非交付型证据）是 unknown，不是“跑过但没绿”；
  // 这一步要不要证明，由 requiresProofOf 说了算，不在这里猜。
  const status = typeof proof?.status === 'string' ? proof.status : 'unknown'
  const entries = listOf(proof?.entries)
  return {
    status,
    weak: proof?.weak === true,
    error: typeof proof?.error === 'string' ? proof.error : '',
    // 验收员要亲手重跑的入口：只有 verified 的证明才有。
    entries: status === 'verified'
      ? entries
        .map(item => item?.entry)
        .filter(entry => typeof entry === 'string' && entry.trim() !== '')
      : [],
    // 退回时给执行官看的第一条失败输出。
    failedOutput: entries.find(item => item?.status !== 'verified')?.output ?? '',
  }
}

// 交付自身的事实：证明、包外改动、改动文件。与判定无关，同一份证据算一次就够了。
export const deliveryFactsOf = ({ evidence }) => {
  const meta = evidence?.meta ?? {}
  const changedFiles = listOf(meta.changedFiles).length > 0 ? meta.changedFiles : listOf(meta.files)
  return {
    changedFiles: listOf(changedFiles),
    proof: proofOf(meta.proof),
    outOfBounds: {
      files: listOf(meta.outOfBounds?.files),
      reverted: listOf(meta.outOfBounds?.reverted),
    },
  }
}

// 这一步要不要可重跑的证明：声明了契约要求（clauseIds / 工作包）就要，
// 除非计划把证明放到后面某一步（那一步的工作包里就有证明文件）——那一步才要。
// 没有声明的房间（示例房、非交付型证据）不拿证明来拦。
const isProofPath = file => file === PROOF_FILE || file === PROOF_DIR || String(file).startsWith(`${PROOF_DIR}/`)

// 这一步自己就在交证明文件（“交付 lodge-proof.json”这种阶段）：
// 它的证明不可能“改动前也失败”——文件本来就是这一步才有的。
// 对这一步谈“证明偏弱”只会逼执行官把同一份证明再交一遍，永远过不去。
export const deliversProofOf = stage => (Array.isArray(stage?.packages) ? stage.packages : [])
  .flatMap(pkg => (Array.isArray(pkg?.files) ? pkg.files : []))
  .some(isProofPath)

export const requiresProofOf = ({ room, stage, stageIndex }) => {
  const declared = (Array.isArray(stage?.clauseIds) && stage.clauseIds.length > 0) ||
    (Array.isArray(stage?.packages) && stage.packages.length > 0)
  if (!declared) return false
  const ours = (Array.isArray(stage?.packages) ? stage.packages : [])
    .flatMap(pkg => (Array.isArray(pkg?.files) ? pkg.files : []))
  if (ours.some(isProofPath)) return true
  const stages = Array.isArray(room?.stages) ? room.stages : []
  return !stages.some((later, index) => index > stageIndex && (Array.isArray(later?.packages) ? later.packages : [])
    .flatMap(pkg => (Array.isArray(pkg?.files) ? pkg.files : []))
    .some(isProofPath))
}

// 交付自身的 blocker：这些问题出在交付上，和谁来验收无关。
export const deliveryBlockersOf = ({ facts, requireProof = false, proofIsDeliverable = false }) => {
  const blockers = []
  const { files, reverted } = facts.outOfBounds
  if (files.length > 0 && reverted.length < files.length) {
    blockers.push({
      code: 'out-of-bounds',
      reason: 'conflict',
      text: `这一步改过工作包之外的文件：${files.slice(0, 5).join('、')}；先处理再验收。`,
    })
  }
  const { proof } = facts
  if (proof.status === 'failed') {
    blockers.push({
      code: 'proof-failed',
      reason: 'conflict',
      text: proof.error === '' ? '交付证明没跑绿。' : `交付证明没跑绿：${proof.error}`,
    })
  } else if (proof.status !== 'verified' && (requireProof || proof.status !== 'unknown')) {
    blockers.push({
      code: 'proof-missing',
      reason: 'conflict',
      text: '交付没有可重跑的证明，不能确认；先让执行官补 lodge-proof.json',
    })
  }
  // 证明在改动前也绿 = 没有绑定这次改动；只有 verified 的证明才谈得上“证明这一步”。
  // 这一步本身就是交证明文件的，不谈这一条。
  if (proof.status === 'verified' && proof.weak === true && !proofIsDeliverable) {
    blockers.push({
      code: 'proof-weak',
      reason: 'conflict',
      text: '交付的证明在改动前也通过，不能证明这一步；补一条会先在旧版本失败的检查，或把这一步标成“行为不变”。',
    })
  }
  return blockers
}

// 这一阶段的判定 blocker：谁验的、验没验完，和交付本身无关。
export const verdictBlockersOf = ({ room, stageIndex, messages, evidence, floor = 0, requireOutcome = true }) => {
  const ordered = listOf(messages)
  const latest = ordered.filter(message => (
    message.kind === 'verdict' && (message.meta?.stage ?? 0) === stageIndex && (message.seq ?? 0) > floor
  )).at(-1)
  if (latest !== undefined && !verdictPassed(latest)) {
    return [{ code: 'verdict-rejected', reason: 'conflict', text: '验收员退回了，先重做再交一次' }]
  }
  // 没有验收员的房间只认“最新判定不是退回”；有没有人验完不归这里管。
  if (!requireOutcome) return []
  const outcome = reviewState({ room, evidence, messages: ordered, stageIndex })
  if (outcome.state === REVIEW_STATE.pass) return []
  if (outcome.state === REVIEW_STATE.reject) {
    return [{ code: 'verdict-rejected', reason: 'conflict', text: '验收员退回了，先重做再交一次' }]
  }
  if (outcome.state === REVIEW_STATE.pending) {
    return [{ code: 'review-pending', reason: 'conflict', text: '还有验收员没有回报，不能确认' }]
  }
  return [{ code: 'not-accepted', reason: 'conflict', text: '本轮结果还没有验收通过，不能确认' }]
}

// 一处裁决：能不能签收，只看这一份结果。
// 返回 { ok, stage, facts, blockers }；blockers 为空才是可验收。
export const acceptanceOf = ({ room, stageIndex, messages, evidence, floor = 0 }) => {
  const stage = Number.isInteger(stageIndex) ? room?.stages?.[stageIndex] : undefined
  const ordered = listOf(messages)
  const found = resultEvidenceFor(room, evidence, ordered, stageIndex)
  if (found === undefined) {
    return {
      ok: false,
      stage,
      facts: null,
      blockers: [{ code: 'no-result', reason: 'conflict', text: '执行官还没有交回结果，不能验收' }],
    }
  }
  const facts = deliveryFactsOf({ evidence: found })
  const blockers = [
    ...deliveryBlockersOf({
      facts,
      requireProof: requiresProofOf({ room, stage, stageIndex }),
      proofIsDeliverable: deliversProofOf(stage),
    }),
    ...verdictBlockersOf({
      room,
      stageIndex,
      messages: ordered,
      evidence: found,
      floor,
      // 没有验收员的房间按结果证据签收：判定这一侧没有可等的人。
      requireOutcome: verifierIds(room).length > 0,
    }),
  ]
  return { ok: blockers.length === 0, stage, facts, blockers, evidence: found }
}
