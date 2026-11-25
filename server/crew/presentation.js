import { humanNameOf } from './human-name.js'
import { roomAttention } from './attention.js'
import { independenceLabel } from './digest.js'
import { capabilitiesFor } from './rooms/kinds.js'
import { roomPresentationOfRoom } from './rooms/kinds.js'
import { stripAttachmentTags } from '../../shared/attachments.js'
import { prDraftOf } from '../../shared/pr-draft.js'

// 房间能力是 opt-in 开关，不是房型分类；默认关闭，旧房间不受影响。
const DEFAULT_ROOM_CAPABILITIES = Object.freeze({ dispatch: false })
const roomCapabilities = room => ({
  ...DEFAULT_ROOM_CAPABILITIES,
  ...(room?.capabilities ?? {}),
})

// 房间事件与状态查询共用同一份投影，UI 不再自己重算业务状态和独立性文案。
const publicBody = body => {
  if (body === undefined || body === null) return body
  const { ref, roomRef, sessionRef, ...rest } = body
  return rest
}

// 外层只看到房间、成员和交付；基座房间、身体地址和隐藏消息留在适配层。
export const presentRoom = (room, messages = [], assignments = []) => {
  const {
    chatRoom,
    chatHost,
    hiddenBaseMessages,
    seatBots,
    seatNames,
    seatSpecs,
    ...visibleRoom
  } = room
  // 附件标记只给模型看；界面和生成出来的标题都不该带着它。
  const presentation = roomPresentationOfRoom(room)
  const host = presentation?.hostOf?.(room) ?? null
  const visible = {
    ...visibleRoom,
    humanName: humanNameOf() || undefined,
    goal: stripAttachmentTags(room.goal),
    members: (presentation?.membersOf?.(room) ?? room.members ?? []).map(member => ({ ...member, body: publicBody(member.body) })),
    hostLabel: typeof host?.displayName === 'string' ? host.displayName : '',
  }
  const projection = presentation?.projectWork?.(room, assignments) ?? null
  const view = {
    ...visible,
    ...(projection ?? {}),
    ...(projection === null ? {} : { assignments }),
  }
  const attention = roomAttention(view, messages)
  const baseDelivery = presentation?.deliveryOf?.(view, messages) ?? null
  const prDraft = baseDelivery === null ? null : prDraftOf(view, messages, baseDelivery)
  const delivery = baseDelivery === null ? null : { ...baseDelivery, prDraft }
  return {
    ...view,
    revision: room.version ?? 1,
    capabilities: roomCapabilities(room),
    attention,
    needsYou: attention[0] ?? null,
    modeCapabilities: capabilitiesFor(room.roomType),
    independenceLabel: independenceLabel(room),
    delivery,
    prDraft,
    issues: presentation?.issuesOf?.(view, messages) ?? [],
    retro: presentation?.retroOf?.(view, messages) ?? null,
  }
}
