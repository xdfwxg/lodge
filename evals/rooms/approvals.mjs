// 评测房自己只替一类操作拍板：删系统临时目录。其余动作仍留给真人。
// 夜里跑评测时，执行官常先清一个 /tmp 下的临时副本；这不是产品里的真实外部动作。
const ABS_PATH = /(?:^|[\s"'=])(\/[^\s"';&|]+)/g

export const isTempDeleteApproval = approval => {
  if (approval === null || typeof approval !== 'object') return false
  if (approval.state !== 'pending' || approval.kind !== 'delete') return false
  const target = String(approval.target ?? '')
  if (!/^\/tmp\/[^/]/.test(target)) return false
  const command = String(approval.command ?? '')
  if (command.trim() === '') return false
  const paths = [...command.matchAll(ABS_PATH)].map(match => match[1])
  if (paths.length === 0) return false
  return paths.every(path => path === '/tmp' || (path.startsWith('/tmp/') && !path.split('/').includes('..')))
}
