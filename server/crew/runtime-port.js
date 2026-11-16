// Runtime 端口：业务层只依赖这里声明的方法与规范化事件。
// 具体基座在组合根装配；换 runtime 时实现同一份端口，并跑同一组契约测试。
// 基座是第一个实现，不是唯一实现。具身机器人不是新角色：同一席位换一个
// surface 实现这组端口；角色仍是规划师、执行官、验收员。
//
// 规范化事件：
//   { type: 'delta',   sessionRef, turnId, delta, at }
//   { type: 'message', message }                  // message 已归一化为 kind/text/meta
//   { type: 'room',    room }                     // room 已归一化为 Room 形状
// 连接状态：
//   { connected: boolean, error: string | null }
//
// 规范化 Room：
//   { id, name, sessionRef, goal, working, busyRef, queue, holds, heldMessages,
//     tasks, unread, cwd }

export const RUNTIME_EVENT = Object.freeze({
  delta: 'delta',
  message: 'message',
  room: 'room',
})

export const RUNTIME_METHOD_GROUPS = Object.freeze({
  turns: Object.freeze(['sendTurn', 'steerRoomQueue', 'cancelRoomQueue', 'cancelTurn', 'history', 'subscribe']),
  rooms: Object.freeze([
    'rooms', 'createRoom', 'deleteRoom', 'updateRoomMembers',
    'setRoomMentions', 'setRoomHold', 'markRoomRead',
  ]),
  seats: Object.freeze(['createSeatBot', 'setBotSkills', 'deleteSeatBot', 'instances']),
  cards: Object.freeze(['answerCard']),
  observability: Object.freeze(['health', 'capabilities']),
})

export const RUNTIME_NAMESPACES = Object.freeze({
  mcp: Object.freeze(['list', 'create', 'update', 'patch', 'remove']),
})

export const RUNTIME_METHODS = Object.freeze(
  Object.values(RUNTIME_METHOD_GROUPS).flat(),
)

// 组合根调用一次：适配器缺方法就启动失败，而不是等业务跑到一半才报错。
export const assertRuntimePort = runtime => {
  if (runtime === null || typeof runtime !== 'object') {
    throw new Error('runtime 端口必须是一个对象')
  }
  const missing = RUNTIME_METHODS.filter(name => typeof runtime[name] !== 'function')
  if (missing.length > 0) {
    throw new Error(`runtime 端口缺少方法：${missing.join('、')}`)
  }
  for (const [namespace, methods] of Object.entries(RUNTIME_NAMESPACES)) {
    const target = runtime[namespace]
    const lacking = methods.filter(name => typeof target?.[name] !== 'function')
    if (lacking.length > 0) {
      throw new Error(`runtime 端口缺少 ${namespace}.${lacking.join('、')}`)
    }
  }
  const capabilities = runtime.capabilities()
  if (capabilities === null || typeof capabilities !== 'object') {
    throw new Error('runtime.capabilities() 必须返回对象')
  }
  return runtime
}

export const runtimeCapabilities = runtime => (
  typeof runtime?.capabilities === 'function' ? runtime.capabilities() ?? {} : {}
)

// 可选能力一律 fail closed：没有明确声明 true，就当不支持。
export const supportsRuntime = (runtime, name) => runtimeCapabilities(runtime)[name] === true
