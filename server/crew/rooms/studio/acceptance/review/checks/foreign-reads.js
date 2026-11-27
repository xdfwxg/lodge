import { INTERNAL_PROMPT_MARKER } from '../../../../../internal-prompts.js'
import { sanitizeUntrusted } from '../../../../../../../shared/untrusted-text.js'
import { memberDisplayName } from '../../../../../member-labels.js'
import { foreignReadsOf } from '../../read-boundary.js'

// 证据只能来自复核员自己的副本：读到别人工作树或集成目录，看到的不是这次交付的现场。
export const foreignReadsCheck = ({ pending, judgment, calls, room, memberId }) => {
  if (judgment.decision !== 'pass') return null
  const foreign = foreignReadsOf({ calls, room, memberId })
  if (foreign.length === 0) return null
  const name = memberDisplayName(room, memberId)
  return {
    flag: 'boundaryNudged',
    nudge: [
      'PASS 引用了不属于你复核副本的东西：',
      ...foreign.slice(0, 5).map(item => `- ${sanitizeUntrusted(item.path, 300)}（${item.root}）`),
      '证据只能来自你自己的复核副本；请在那里重新读文件或跑检查，再提交一次。',
      INTERNAL_PROMPT_MARKER,
    ].join('\n'),
    expire: `${name} 的判定用了别人副本里的证据，这一轮仍未通过。`,
  }
}
