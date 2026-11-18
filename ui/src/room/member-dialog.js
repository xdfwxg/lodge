// 侧栏是成员的唯一入口，房间视图负责打开对话框；这里只传一个请求。
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
