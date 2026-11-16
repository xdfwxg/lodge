import { createBaseSurface } from './surfaces/base.js'
import { envelopeFor } from './seat-delivery.js'
import { createSurfaceRegistry } from './surface-port.js'

export const createSurfaces = ({ engine, store, extra = [] }) => createSurfaceRegistry({
  surfaces: [createBaseSurface({ engine }), ...extra],
})

// 业务只认识“交给哪个席位”。身体由房间绑定决定；默认是基座，测试可注入回声。
export const deliverToSeat = async ({
  engine,
  store,
  roomId,
  room = null,
  seat,
  surfaces = null,
  envelope = null,
  ...message
}) => {
  const current = store.readRoom(roomId) ?? room
  const registry = surfaces ?? createSurfaces({ engine, store })
  const surface = registry.of(current, seat)
  return surface.send({
    engine,
    store,
    roomId,
    room: current,
    seat,
    ...message,
    envelope: envelope ?? envelopeFor(current, message.from ?? '', message.intent ?? 'handoff'),
  })
}
