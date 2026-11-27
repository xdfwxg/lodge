import { INTERNAL_PROMPT_MARKER } from '../../../../../internal-prompts.js'
import { sanitizeUntrusted } from '../../../../../../../shared/untrusted-text.js'
import { memberDisplayName } from '../../../../../member-labels.js'
import { coverageClausesOf, coverageGapsOf, coverageRequirementsOf } from '../../coverage.js'

// PASS 的覆盖表要对得上这一阶段真正要交的东西：有契约按契约要求，没有就按本步交付物。
// 文本通道的兜底同样过这一关，避免换个入口绕过覆盖。
export const coverageCheck = ({ pending, judgment, room, memberId }) => {
  if (judgment.decision !== 'pass') return null
  const clauses = coverageClausesOf({ room, stageIndex: pending.stage })
  const gaps = coverageGapsOf({
    coverage: judgment.coverage,
    requirements: clauses.length > 0
      ? clauses
      : coverageRequirementsOf({ room, stageIndex: pending.stage }),
  })
  if (gaps.length === 0) return null
  const name = memberDisplayName(room, memberId)
  return {
    flag: 'coverageNudged',
    nudge: [
      'PASS 的覆盖表还差这些要求：',
      ...gaps.map(item => `- ${sanitizeUntrusted(typeof item === 'string' ? item : `[${item.id}] ${item.statement}`, 300)}`),
      '请重新调用 submit_verdict：coverage 的 item 原样抄这些要求，evidence 写你实际读过的文件、跑过的检查或看到的结果。',
      INTERNAL_PROMPT_MARKER,
    ].join('\n'),
    expire: `${name} 的判定没有逐条覆盖这一步的要求，这一轮仍未通过。`,
  }
}
