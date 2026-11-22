// 交付记录：把房间里的目标、步骤、证据、结论压成一份能带走的 Markdown。
// 只读房间记录，不重算业务判断；没有的记录就省略，不补想象。
import { judgmentOf } from '../../../../shared/judgment.js'
import { stripAttachmentTags } from '../../../../shared/attachments.js'
import { idleDelivered } from '../../../../shared/room-status.js'

const line = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const when = ts => {
  if (typeof ts !== 'number' || ts <= 0) return ''
  const date = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const nameOf = (members, id) => (members ?? []).find(member => member.id === id)?.name ?? id ?? '成员'

const stageRows = room => (room.stages ?? []).map((stage, index) => {
  const status = stage.state === 'passed' ? '已完成' : stage.state === 'active' ? '进行中' : '未开始'
  const acceptance = typeof stage.acceptance === 'string' && stage.acceptance !== ''
    ? ` · 检查：\`${stage.acceptance}\``
    : ''
  return `${index + 1}. ${line(stage.title)} — ${status}${acceptance}`
})

const evidenceRows = room => (room.messages ?? [])
  .filter(message => message.kind === 'evidence' && message.meta?.kind === 'command')
  .map(message => {
    const exit = message.meta?.exit
    return `- 第 ${(message.meta?.stage ?? 0) + 1} 步：\`${line(message.meta?.command)}\` → 退出码 ${exit === undefined || exit === null ? '无' : exit}`
  })

const verdictRows = room => (room.messages ?? [])
  .filter(message => message.kind === 'verdict')
  .map(message => {
    const stage = `第 ${(message.meta?.stage ?? 0) + 1} 步`
    const pass = message.meta?.pass === true ? '通过' : '不通过'
    const text = line(judgmentOf(message)?.reason || String(message.text ?? '').split('\n')[0])
      .replace(/^\s*(?:(?:PASS|REJECT)\b|不通过|通过)[：:\s-]*/i, '')
      .slice(0, 200)
    return `- ${stage}：${pass} · ${nameOf(room.members, message.authorId)}${text === '' ? '' : ` · ${text}`}`
  })

const fileRows = room => {
  const files = new Set()
  for (const message of room.messages ?? []) {
    for (const file of message.meta?.changedFiles ?? []) files.add(file)
    for (const file of message.meta?.files ?? []) files.add(file)
  }
  return [...files]
}

export const deliveryRecord = room => {
  if (room === null || room === undefined) return ''
  const delivered = idleDelivered(room)
  const completedAt = room.completedAt ?? room.archivedAt ?? null
  const blocks = [
    `# ${line(room.name) || '房间交付记录'}`,
    '',
    `目标：${line(stripAttachmentTags(room.goal))}`,
    `状态：${delivered ? '已交付' : room.archivedAt ? '已归档' : room.state === 'active' ? '进行中' : room.state === 'paused' ? '已暂停' : room.state === 'stopped' ? '已停止' : '空闲中'}`,
    completedAt === null ? '' : `完成时间：${when(completedAt)}`,
    '',
    '## 步骤',
    ...stageRows(room),
    '',
    '## 检查',
    ...(evidenceRows(room).length > 0 ? evidenceRows(room) : ['- 没有运行检查']),
    '',
    '## 验收',
    ...(verdictRows(room).length > 0 ? verdictRows(room) : ['- 没有验收结论']),
    '',
    '## 交付',
    ...(fileRows(room).length > 0 ? fileRows(room).map(file => `- ${file}`) : ['- 没有记录交付文件']),
    room.branch === undefined || room.branch === '' ? '' : `分支：${room.branch}`,
    room.completedCommit === undefined || room.completedCommit === null || room.completedCommit === '' ? '' : `提交：${room.completedCommit}`,
  ]
  return blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

export const downloadDeliveryRecord = room => {
  const text = deliveryRecord(room)
  if (text === '') return false
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const safe = (line(room.name) || 'room').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60)
  anchor.href = url
  anchor.download = `${safe}.md`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return true
}
