import { INTERNAL_PROMPT_MARKER } from '../../../../../internal-prompts.js'
import { sanitizeUntrusted } from '../../../../../../../shared/untrusted-text.js'
import { memberDisplayName } from '../../../../../member-labels.js'

// 受保护文件必须逐条确认：锁文件、包清单、CI/配置、.env 不能靠一句“通过”放行。
// 两条通道都要过这一关；确认可以写在工具参数里，也可以写在文本的 json 里。
export const protectedFilesCheck = ({ pending, judgment, room, memberId }) => {
  if (judgment.decision !== 'pass') return null
  const protectedFiles = Array.isArray(pending.protectedFiles) ? pending.protectedFiles : []
  if (protectedFiles.length === 0) return null
  const acknowledged = Array.isArray(judgment.protectedFiles) ? judgment.protectedFiles : []
  const unacknowledged = protectedFiles.filter(file => !acknowledged.includes(file))
  if (unacknowledged.length === 0) return null
  const name = memberDisplayName(room, memberId)
  return {
    flag: 'protectedNudged',
    nudge: [
      `这次改动包含受保护文件：${unacknowledged.map(file => sanitizeUntrusted(file, 200)).join('、')}。`,
      'PASS 要逐条确认这些文件：调用 submit_verdict 时填 protectedFiles；工具不可用时在文本的 json 里写同一字段。不认可就判不通过，或交给人。',
      INTERNAL_PROMPT_MARKER,
    ].join('\n'),
    expire: `${name} 的判定没有逐条确认受保护文件，这一轮仍未通过。`,
  }
}
