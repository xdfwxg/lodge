// 人说过的补充不是聊天噪声：单独落一条，带上阶段和时间，重做与复盘都能引用。
export const appendHumanContext = ({ store, roomId, stage = null, text, source }) => {
  const value = String(text ?? '').trim().slice(0, 2000)
  if (value === '') return null
  return store.appendMessage(roomId, {
    kind: 'human-context',
    authorId: 'you',
    text: value,
    meta: {
      stage: Number.isInteger(stage) ? stage : null,
      source,
      at: Date.now(),
    },
  })
}
