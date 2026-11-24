// 房间之间的交接种子：聊天→工作室、工作室→聊天、以及新房间对话框的目标文本。
// 这是界面之间的组合，只服务于预填；房间真相仍在服务端。
import { normalizeHandoffBrief } from '../../shared/handoff-brief.js'
import { stripAttachmentTags } from '../../shared/attachments.js'
import { normalizeReceipt, receiptText } from '../../shared/receipt.js'
import { STAGE_STATE } from '../../shared/states.js'

// 聊天结论只作为小屋的交接简报；不复制聊天状态、证据或阶段。
export const chatStudioSeed = ({ room, conclusion, handoffBrief, conclusionId = '' }) => {
  const text = String(conclusion ?? '').trim()
  const structured = normalizeHandoffBrief(handoffBrief)
  return {
    goal: structured?.topic || stripAttachmentTags(room?.goal ?? ''),
    conclusion: text,
    sourceName: String(room?.name ?? '').trim(),
    ...(typeof room?.id === 'string' && room.id !== '' ? { sourceRoomId: room.id } : {}),
    ...(typeof conclusionId === 'string' && conclusionId !== '' ? { conclusionId } : {}),
    ...(structured === null ? {} : { handoffBrief: structured }),
  }
}

// 顶层房间不会完成为 complete，回执就从房间本身拼：阶段、检查、改动，不搬过程。
const deliveryOf = room => {
  if (room?.delivery !== null && room?.delivery !== undefined) return room.delivery
  const stages = Array.isArray(room?.stages) ? room.stages : []
  if (stages.length === 0 || stages.some(stage => stage.state !== STAGE_STATE.passed)) return null
  const messages = Array.isArray(room?.messages) ? room.messages : []
  const commands = messages
    .filter(message => message.kind === 'evidence' && message.meta?.kind === 'command')
    .map(message => ({ exit: message.meta?.exit ?? null }))
  const files = new Set()
  for (const message of messages) {
    for (const file of message.meta?.files ?? []) files.add(file)
  }
  return {
    name: room?.name ?? '这次做出来的',
    stages,
    commands,
    changedFiles: [...files],
    openQuestions: [],
  }
}

// 工作室 → 聊天室只带回执：结果、完成度、检查与开放问题，不搬房间过程。
export const returnToChatSeed = room => {
  const delivery = deliveryOf(room)
  if (delivery === null || delivery === undefined) return null
  const commands = delivery.commands ?? []
  const stages = delivery.stages ?? []
  const done = stages.filter(stage => stage.state === STAGE_STATE.passed).length
  const passed = commands.filter(command => command.exit === 0).length
  const changed = delivery.changedFiles?.length ?? 0
  const simulated = commands.some(command => command.simulated === true)
  const receipt = normalizeReceipt({
    result: delivery.name,
    completeness: stages.length > 0
      ? `${done}/${stages.length} 步完成${changed > 0 ? `，${changed} 个文件` : ''}`
      : changed > 0 ? `${changed} 个文件` : '已交付',
    checks: commands.length > 0
      ? [`${passed}/${commands.length} 项检查通过${simulated ? '（含模拟）' : ''}`]
      : ['人工验收通过'],
    paths: delivery.changedFiles ?? [],
    openQuestions: delivery.openQuestions ?? [],
  })
  return {
    goal: `评审这次做出来的：${delivery.name}`,
    conclusion: receiptText(receipt),
    label: '这次做出来的',
    sourceName: delivery.name,
    sourceRoomId: room.id,
    // 成果在工作副本里；聊天室读这份副本，才不是只看见源仓库的 README。
    ...(typeof room.repoPath === 'string' && room.repoPath !== '' ? { repoPath: room.repoPath } : {}),
    receipt,
  }
}

// 交接简报本身进入工作室指令，目标只留主题；回执与普通结论才展开成文本。
export const seedGoalText = seed => {
  if (seed?.handoffBrief !== null && seed?.handoffBrief !== undefined) {
    const topic = String(seed.handoffBrief.topic ?? '').trim() || String(seed?.goal ?? '').trim()
    return topic.slice(0, 2000)
  }
  const goal = String(seed?.goal ?? '').trim()
  const structured = seed?.receipt ? receiptText(seed.receipt) : ''
  const conclusion = structured !== '' ? structured : String(seed?.conclusion ?? '').trim()
  const label = typeof seed?.label === 'string' && seed.label !== '' ? seed.label : '聊天室结论'
  const text = conclusion === '' ? goal : `${goal}\n\n${label}：\n${conclusion}`
  return text.slice(0, 2000)
}
