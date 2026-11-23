// 侧栏是成员的主入口；房间因成员出错停下时，也直接打开同一张卡。这里只传请求。
const listeners = new Set()

export const onMemberDialog = listener => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// 请求带上房间：侧栏成员面板可能属于另一间房，不能让当前房间按同名 id 打开别人的成员。
export const openBodyDialog = (memberId, roomId = null) => {
  for (const listener of listeners) listener({ kind: 'body', memberId, roomId })
}

export const openAddMemberDialog = () => {
  for (const listener of listeners) listener({ kind: 'add' })
}
