import { createBaseSurface } from './surfaces/base.js'
import { envelopeFor } from './member-delivery.js'
import { createSurfaceRegistry } from './surface-port.js'

export const createSurfaces = ({ engine, store, extra = [] }) => createSurfaceRegistry({
  surfaces: [createBaseSurface({ engine }), ...extra],
})

// 业务只认识“交给哪个成员”。身体由房间成员决定；默认是基座，测试可注入回声。
export const deliverToMember = async ({
  engine,
  store,
  roomId,
  room = null,
  memberId,
  surfaces = null,
  envelope = null,
  ...message
}) => {
  const current = store.readRoom(roomId) ?? room
  const registry = surfaces ?? createSurfaces({ engine, store })
  const surface = registry.of(current, memberId)
  return surface.send({
    engine,
    store,
    roomId,
    room: current,
    memberId,
    ...message,
    envelope: envelope ?? envelopeFor(current, message.from ?? '', message.intent ?? 'handoff'),
  })
}
