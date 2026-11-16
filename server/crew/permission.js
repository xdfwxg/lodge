// 业务只认语义动作；工具名到 read/exec/write 的映射在引擎适配层。
export const decidePermission = (member, action, { readOnly = false, direct = false } = {}) => {
  if (!['read', 'exec', 'write'].includes(action)) return false
  if (readOnly && (action === 'write' || action === 'exec')) return false
  // 原地目录没有独立副本：验收员只能读，避免 exec 直接改交付物。
  if (direct && (member?.role === 'verifier' || member?.roleKind === 'verifier') && action !== 'read') return false
  return member?.permissions?.[action] === true
}
