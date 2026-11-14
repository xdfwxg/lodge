// 工作室对外 Facade：其他上下文只读这里的瘦 DTO，不直接摸 closure/stages。
export const STUDIO_DTO_VERSION = 1

export const studioStateOf = room => room?.closure ?? null

export const studioStagesOf = room => (Array.isArray(room?.stages) ? room.stages : [])

export const studioFacade = {
  version: STUDIO_DTO_VERSION,
  hasState: room => studioStateOf(room) !== null || Array.isArray(room?.stages),
  snapshot(room) {
    if (!studioFacade.hasState(room)) return null
    return {
      version: STUDIO_DTO_VERSION,
      closure: studioStateOf(room) ?? 'open',
      stages: studioStagesOf(room).map(stage => ({
        id: stage.id,
        title: stage.title,
        kind: stage.kind,
        state: stage.state,
      })),
      verifiers: [...(room.verifiers ?? [])],
      delivery: room.state === 'complete',
    }
  },
}
