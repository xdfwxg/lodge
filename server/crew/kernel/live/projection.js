export const memberForRef = (room, ref) => {
  if (typeof ref !== 'string' || ref === '') return null
  for (const member of room?.members ?? []) {
    if (member?.body?.ref === ref) return member.id
  }
  return null
}

import { memberDisplayName, toDisplayText } from '../../member-labels.js'
import { actionForTool } from '../../../../shared/tool-action.js'
import { isInternalPrompt } from '../../internal-prompts.js'
import { roomPresentationOfRoom } from '../../rooms/kinds.js'
import { attemptScopeOf } from '../../../../shared/attempt.js'

export const memberNameOf = memberDisplayName

// 基座忙碌时发出的消息会排队，落库 id 和发送响应 id 不同；用回显文本和落库时间配对，避免同一条人的话出现两次。
const ECHO_WINDOW_MS = 120_000

export const matchEcho = (messages, text, at) => {
  if (!Array.isArray(messages)) return undefined
  const candidates = messages.filter(message => (
    message?.authorId === 'you' &&
    message?.meta?.echo === true &&
    message?.meta?.baseId === undefined &&
    message?.text === text
  ))
  if (candidates.length === 0) return undefined
  if (typeof at !== 'number') return candidates[candidates.length - 1]
  const near = candidates.filter(message => (
    typeof message.ts === 'number' && Math.abs(message.ts - at) < ECHO_WINDOW_MS
  ))
  return near.sort((a, b) => Math.abs(a.ts - at) - Math.abs(b.ts - at))[0]
}

export const createMessageProjector = ({ store }) => {
  const toStored = (roomId, message) => {
    const room = store.readRoom(roomId)
    if (room?.hiddenBaseMessages?.includes(message.id) === true) return null
    // 影子评审不在房间里发言：它的回复只进 advice，不进时间线。
    if (typeof room?.shadowBot?.memberRef === 'string' && message.authorRef === room.shadowBot.memberRef) return null
    // 多人聊天室里，主持人只通过系统落库的开场和结论说话；基座里它的原话（包括选班底的 JSON）不进时间线。
    const hostRef = roomPresentationOfRoom(room)?.hostOf?.(room)?.memberRef
    if (
      typeof hostRef === 'string' && hostRef !== '' &&
      message.authorRef === hostRef && (room?.members ?? []).length > 0
    ) return null
    if (isInternalPrompt(message.text)) return null
    const memberId = memberForRef(room, message.authorRef)
    const common = { id: message.id, roomId, ts: message.at }
    const text = toDisplayText(room, message.text)
    // 基座会在一条回答后再补一条空 text；它不是一句话，不该变成空气泡。
    if (String(text ?? '').trim() === '') return null
    if (message.role === 'user') return { ...common, kind: 'chat', authorId: 'you', text }
    // 聊天室只展示真正的发言；基座的 recent-work brief 之类运行提示不是聊天内容。
    if (message.kind === 'activity' && roomPresentationOfRoom(room)?.hideActivity === true) return null
    if (message.kind === 'activity') {
      const rawTool = typeof message.tool?.name === 'string' ? message.tool.name.trim() : ''
      // 基座偶尔把「XX 的 recent-work brief」这类说明塞进 tool.name；只保留工具标识。
      const tool = /^[\w.:/-]+$/.test(rawTool) ? rawTool : ''
      // 动作分类是业务事实，界面和审批都不再各自按名字猜。
      const action = actionForTool(rawTool)
      // 工具在做什么（命令、文件）只留短摘要，让界面能说“在干啥”；完整输出仍走证据。
      const step = message.tool?.step ?? {}
      const hint = value => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 200) : '')
      const target = hint(step.target)
      const detail = hint(step.detail)
      return {
        ...common,
        kind: 'activity',
        authorId: memberId ?? 'executor',
        text,
        meta: {
          ok: message.ok,
          ...(tool === '' ? {} : { tool }),
          ...(action === null ? {} : { action }),
          ...(target === '' ? {} : { target }),
          ...(detail === '' ? {} : { detail }),
        },
      }
    }
    if (message.kind === 'question') {
      if (message.card?.requestId === undefined) {
        return { ...common, kind: 'system', text: `待处理：${text}` }
      }
      // 卡片只属于产生它的阶段和重做轮次；阶段推进或重做后自然失效。
      const scope = attemptScopeOf({
        room,
        messages: store.readMessages?.(roomId) ?? [],
        memberId,
      })
      return {
        ...common,
        kind: 'question',
        authorId: memberId ?? 'executor',
        text,
        meta: { card: { ...message.card, scope } },
      }
    }
    // digest 是基座的上下文摘要，不是成员说的话；notice 等是运行提示，归系统，不伪装成聊天。
    if (message.kind === 'digest') return null
    if (['notice', 'lookup', 'resumed', 'cut', 'stopped', 'done'].includes(message.kind)) {
      return text === '' ? null : { ...common, kind: 'system', text }
    }
    // 回合身份留在消息上：同一个成员的一次回答若被拆成几条，房间只留最后一条。
    const turnMeta = typeof message.turnId === 'string' && message.turnId !== ''
      ? {
        turnId: message.turnId,
        ...(typeof message.turnFinal === 'boolean' ? { turnFinal: message.turnFinal } : {}),
      }
      : null
    return {
      ...common,
      kind: 'chat',
      authorId: memberId ?? 'executor',
      text,
      ...(turnMeta === null ? {} : { meta: turnMeta }),
    }
  }

  return { toStored }
}
