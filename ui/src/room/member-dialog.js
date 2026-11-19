// 侧栏是成员的主入口；房间因成员出错停下时，也直接打开同一张卡。这里只传请求。
const listeners = new Set()

export const onMemberDialog = listener => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const openBodyDialog = memberId => {
  for (const listener of listeners) listener({ kind: 'body', memberId })
}

export const openAddMemberDialog = () => {
  for (const listener of listeners) listener({ kind: 'add' })
}
