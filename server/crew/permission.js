// 业务只认语义动作；工具名到 read/exec/write 的映射在引擎适配层。
export const decidePermission = (member, action, { readOnly = false } = {}) => {
  if (!['read', 'exec', 'write'].includes(action)) return false
  if (readOnly && (action === 'write' || action === 'exec')) return false
  return member?.permissions?.[action] === true
}
