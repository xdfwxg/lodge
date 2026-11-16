// 回声身体：不连基座，只记录“业务交给这个成员什么”。用于测试和未来本地预览。
export const createEchoSurface = ({ kind = 'echo' } = {}) => {
  const deliveries = []
  const operations = []
  const held = new Set()

  return {
    kind,
    deliveries,
    operations,

    async send({ roomId, memberId, text, sendId, intent = 'handoff', from = '', envelope = '' }) {
      const body = [envelope, text].filter(line => line !== '').join('\n')
      deliveries.push({ roomId, memberId, text: body, sendId, intent, from })
      return { accepted: true, echo: true, messageId: `echo-${sendId}`, sendId }
    },

    async cancel({ roomId, queueId }) {
      operations.push({ op: 'cancel', roomId, queueId })
      return { cancelled: true, echo: true }
    },

    async hold({ roomId, memberId, held: next }) {
      operations.push({ op: 'hold', roomId, memberId, held: next })
      if (next) held.add(memberId)
      else held.delete(memberId)
      return { ok: true, echo: true, memberId, held: next }
    },

    state({ roomId, memberId }) {
      return { kind, roomId, memberId, held: held.has(memberId) }
    },

    capabilities: () => ({
      kind,
      send: true,
      cancel: true,
      hold: true,
      stream: false,
    }),
  }
}
