import { gateToolAllowed } from './tool-scope.js'

// 业务只认语义动作；工具名到 read/exec/write 的映射在引擎适配层。
export const decidePermission = (member, action, { readOnly = false, direct = false, tool = '' } = {}) => {
  // 判定工具只属于规划和验收，且同一角色也只能拿到自己的那几件。
  if (action === 'gate') return gateToolAllowed(member, tool)
  if (!['read', 'exec', 'write'].includes(action)) return false
  if (readOnly && (action === 'write' || action === 'exec')) return false
  // 原地目录没有独立副本：验收员只能读，避免 exec 直接改交付物。
  if (direct && (member?.role === 'verifier' || member?.roleKind === 'verifier') && action !== 'read') return false
  return member?.permissions?.[action] === true
}
