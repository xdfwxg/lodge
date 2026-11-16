// 身体体检只读基座表示的可用性：装没装、登录没有。
// 可用性是表示的，不为每具身体发心跳或试跑一回合；没有这项信息就不下结论。
export const bodyIssueOf = instance => {
  if (instance === undefined || instance === null) return ''
  if (instance.available !== true) return instance.reason === '' ? '模型服务不可用' : instance.reason
  if (instance.authenticated === false) return '登录失效'
  return ''
}

export const bodyIssueText = issues => issues
  .filter(item => item.issue !== '')
  .map(item => `${item.member.name}${item.issue}`)
  .join('；')
