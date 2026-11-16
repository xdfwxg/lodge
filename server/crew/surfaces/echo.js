// 回声身体：不连基座，只记录“业务交给这个席位什么”。用于测试和未来本地预览。
export const createEchoSurface = ({ kind = 'echo' } = {}) => {
  const deliveries = []
  const operations = []
  const held = new Set()

  return {
    kind,
    deliveries,
    operations,

    async send({ roomId, seat, text, sendId, intent = 'handoff', from = '', envelope = '' }) {
      const body = [envelope, text].filter(line => line !== '').join('\n')
      deliveries.push({ roomId, seat, text: body, sendId, intent, from })
      return { accepted: true, echo: true, messageId: `echo-${sendId}`, sendId }
    },

    async cancel({ roomId, queueId }) {
      operations.push({ op: 'cancel', roomId, queueId })
      return { cancelled: true, echo: true }
    },

    async hold({ roomId, seat, held: next }) {
      operations.push({ op: 'hold', roomId, seat, held: next })
      if (next) held.add(seat)
      else held.delete(seat)
      return { ok: true, echo: true, seat, held: next }
    },

    state({ roomId, seat }) {
      return { kind, roomId, seat, held: held.has(seat) }
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
