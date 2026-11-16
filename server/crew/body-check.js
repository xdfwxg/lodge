import { engineBlockReason } from '../../shared/engine-readiness.js'

// 身体体检只读基座表示的可用性：装没装、登录没有。
// 可用性是表示的，不为每具身体发心跳或试跑一回合；没有这项信息就不下结论。
export const bodyIssueOf = instance => (
  instance === undefined || instance === null ? '' : engineBlockReason(instance)
)

export const bodyIssueText = issues => issues
  .filter(item => item.issue !== '')
  .map(item => `${item.member.name}${item.issue}`)
  .join('；')
