import { judgmentOf } from '../../../../shared/judgment.js'
import { stripAttachmentTags, withAttachments } from '../../../../shared/attachments.js'

const VERSION_SUFFIX = /\s*·\s*第\s*\d+\s*版$/
const roleOf = member => {
  if (['lead', 'worker', 'verifier'].includes(member?.role)) return member.role
  if (member?.roleKind === 'planner') return 'lead'
  if (member?.roleKind === 'verifier') return 'verifier'
  return 'worker'
}

const nameOf = (room, version) => {
  const base = stripAttachmentTags(room?.name ?? room?.goal ?? '').replace(VERSION_SUFFIX, '').trim() || '下一版'
  return `${base} · 第 ${version} 版`.slice(0, 60)
}

const changedFilesOf = messages => [...new Set((messages ?? []).flatMap(message => (
  Array.isArray(message.meta?.changedFiles) ? message.meta.changedFiles : []
)))].slice(0, 12)

// 已交付的房间不改原地：把「要改什么」变成下一版的目标，原班人马、同一工作区和检查条件沿用。
export const buildFollowupBody = ({ room, messages = [], text = '', attachments = [] } = {}) => {
  if (room === null || room?.roomType !== 'studio') return { error: '只有工作室能接着改' }
  const stages = Array.isArray(room.stages) ? room.stages : []
  const delivered = room.state === 'complete' || (stages.length > 0 && stages.every(stage => stage.state === 'passed'))
  if (!delivered) return { error: '这一步还没交付，先在房间里返工或重开' }
  const words = typeof text === 'string' ? text.trim().slice(0, 2000) : ''
  if (words === '' && attachments.length === 0) return { error: '说一句要改什么' }

  // 新版本的目标可能已经改变验收口径，硬继承上一版命令会让执行官照着旧答案交差。
  // 上一版命令只作为参考；新版本先按新目标做，检查和验收由这一版的证据决定。
  const priorCheck = typeof room.gate?.verification?.command === 'string' && room.gate.verification.command !== ''
    ? room.gate.verification.command
    : (stages.find(stage => typeof stage.acceptance === 'string' && stage.acceptance !== '')?.acceptance ?? '')
  const version = (Number.isInteger(room.generation) ? room.generation : 1) + 1
  const lastVerdict = [...(messages ?? [])].reverse().find(message => message.kind === 'verdict')
  const lastConclusion = [...(messages ?? [])].reverse().find(message => message.kind === 'conclusion')
  const conclusion = (lastVerdict === undefined
    ? ''
    : judgmentOf(lastVerdict)?.reason || lastVerdict.meta?.reason || lastVerdict.text) || lastConclusion?.text || ''
  const files = changedFilesOf(messages)
  const goalText = words === '' ? (attachments[0]?.title ?? '看看这个附件') : words

  return {
    body: {
      goal: withAttachments(goalText, attachments),
      name: nameOf(room, version),
      roomType: 'studio',
      verify: 'manual',
      repoPath: room.repoPath ?? room.sourceRepo ?? '',
      members: (room.members ?? []).map(member => ({
        role: roleOf(member),
        name: member.name,
        ...(member.body?.engine === undefined ? {} : { engine: member.body.engine }),
        ...(member.body?.model === undefined ? {} : { model: member.body.model }),
        ...(typeof member.body?.spec?.prompt === 'string' && member.body.spec.prompt !== ''
          ? { prompt: member.body.spec.prompt }
          : {}),
      })),
      sourceRoomId: room.id,
      sourceName: room.name,
      continuation: {
        fromRoomId: room.id,
        fromRoomName: room.name,
        version,
        goal: stripAttachmentTags(room.goal ?? ''),
        conclusion: conclusion.slice(0, 1000),
        files,
        check: priorCheck || null,
        commit: room.workspaceHead ?? room.completedCommit ?? null,
        at: Date.now(),
      },
    },
  }
}
