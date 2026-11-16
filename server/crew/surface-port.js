// Surface 端口：席位用哪种身体接收和结束工作。基座是第一种实现，
// 以后可以是本机、云、浏览器、手机或机器人；角色和业务决定不变。
export const SURFACE_METHODS = Object.freeze(['send', 'cancel', 'hold', 'state', 'capabilities'])

export const assertSurfacePort = (surface, label = 'surface') => {
  if (surface === null || typeof surface !== 'object') throw new Error(`${label} 必须是一个对象`)
  if (typeof surface.kind !== 'string' || surface.kind === '') throw new Error(`${label} 缺少 kind`)
  const missing = SURFACE_METHODS.filter(name => typeof surface[name] !== 'function')
  if (missing.length > 0) throw new Error(`${label} 缺少方法：${missing.join('、')}`)
  return surface
}

// 房间可以按席位绑定身体；没写就是基座。字符串是简写，展开成 { kind }。
export const surfaceBindingOf = (room, seat) => {
  const spec = (room?.seatSpecs ?? []).find(item => item.id === seat)
  const raw = spec?.surface ?? room?.seatSurfaces?.[seat] ?? null
  if (typeof raw === 'string' && raw !== '') return { kind: raw }
  if (raw !== null && typeof raw === 'object' && typeof raw.kind === 'string' && raw.kind !== '') return raw
  return { kind: 'base' }
}

export const createSurfaceRegistry = ({ surfaces = [] } = {}) => {
  const byKind = new Map()
  const registry = {
    register(surface) {
      assertSurfacePort(surface)
      byKind.set(surface.kind, surface)
      return registry
    },
    get(kind) {
      return byKind.get(kind) ?? null
    },
    of(room, seat) {
      const binding = surfaceBindingOf(room, seat)
      const surface = byKind.get(binding.kind)
      if (surface === null || surface === undefined) {
        throw new Error(`没有 ${binding.kind} 类型的 surface，消息没有送出`)
      }
      return surface
    },
    kinds: () => [...byKind.keys()],
  }
  for (const surface of surfaces) registry.register(surface)
  return registry
}
