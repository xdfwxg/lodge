// 聊天室对外 Facade：其他上下文只读这里的瘦 DTO，不直接摸 room.chat。
export const CHAT_DTO_VERSION = 1

const chatStateOf = room => room?.chat ?? null

const chatHostOf = room => room?.chatHost ?? null

const chatSpeakerOf = room => room?.chat?.speaker ?? ''

const chatRunningOf = room => room?.chat?.running === true

export const chatFacade = {
  version: CHAT_DTO_VERSION,
  hasState: room => chatStateOf(room) !== null,
  hostOf: chatHostOf,
  speakerOf: chatSpeakerOf,
  runningOf: chatRunningOf,
  snapshot(room) {
    const chat = chatStateOf(room)
    if (chat === null) return null
    const host = chatHostOf(room)
    return {
      version: CHAT_DTO_VERSION,
      round: chat.round ?? 1,
      phase: chat.phase ?? 'discussing',
      turns: chat.turns ?? 0,
      turnLimit: chat.turnLimit ?? null,
      conclusionId: chat.conclusionId ?? null,
      accepted: chat.accepted === true,
      running: chat.running === true,
      speaker: chat.speaker ?? '',
      host: host === null ? null : { memberRef: host.memberRef, name: host.name },
    }
  },
}
