// 房间能力是 opt-in 开关，不是房型分类；默认关闭，旧房间不受影响。
export const DEFAULT_ROOM_CAPABILITIES = Object.freeze({
  dispatch: false,
})

export const roomCapabilities = room => ({
  ...DEFAULT_ROOM_CAPABILITIES,
  ...(room?.capabilities ?? {}),
})
