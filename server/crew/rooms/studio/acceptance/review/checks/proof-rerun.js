import { INTERNAL_PROMPT_MARKER } from '../../../../../internal-prompts.js'
import { memberDisplayName } from '../../../../../member-labels.js'
import { verificationProofOf } from '../../verification-proof.js'

// 两种情况，分开处理：
// 1. 这一步要求证明：平台已经在验收员自己的复核副本里跑过一次（review/request.js），
//    结果进了 `pending.facts`，由 proof-facts 那一条负责改判。
//    这里不再要求模型把命令原样再打一遍——重跑是副作用，归平台做。
// 2. 没有证明要求：PASS 之前至少读一个改动文件或跑一条检查，只认这一回合的真实工具调用。
export const proofRerunCheck = ({ pending, judgment, calls, room, memberId }) => {
  if (judgment.decision !== 'pass') return null
  if (pending.requireProof === true) return null
  const proof = verificationProofOf(calls, { changedFiles: pending.changedFiles, requiredEntries: [] })
  if (proof.ok) return null
  const name = memberDisplayName(room, memberId)
  return {
    flag: 'proofNudged',
    nudge: [
      'PASS 之前要先亲手验过：至少读一个这次改动的文件，或跑一条检查。',
      ...(proof.files.length === 0 ? [] : [`这次改动的文件：${proof.files.slice(0, 20).join('、')}。`]),
      INTERNAL_PROMPT_MARKER,
    ].join('\n'),
    expire: `${name} 的判定没有亲手验过，这一轮仍未通过。`,
  }
}
