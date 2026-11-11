// 业务只认语义动作；工具名到 read/exec/write 的映射在引擎适配层。
export const decidePermission = (seatSpec, action) => {
  if (!['read', 'exec', 'write'].includes(action)) return false
  return seatSpec?.permissions?.[action] === true
}
