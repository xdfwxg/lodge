// 席位交接包：永久素材优先，transcript 只给引用，不重发整场对话。
const DONE_LIMIT = 6
const CONSTRAINT_LIMIT = 14
const FEEDBACK_LIMIT = 3
const MAX_CHARS = 2_800

const clip = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}\n…（交接包已截断，完整内容读 transcript）` : text)

const doneOf = room => (
  room.plan?.done ?? room.stages.map(stage => `${stage.title}（${stage.state === 'passed' ? '已过' : '未过'}）`)
)

const feedbackOf = messages => {
  const verdicts = messages.filter(message => message.kind === 'verdict').slice(-FEEDBACK_LIMIT)
  return verdicts.map(message => {
    const mark = message.meta?.pass === true ? 'PASS' : 'REJECT'
    const stage = message.meta?.stage === undefined ? '' : `阶段 ${message.meta.stage + 1} · `
    return `${stage}${mark}：${(message.text ?? '').replace(/\s+/g, ' ').slice(0, 240)}`
  })
}

export const buildSeatHandoff = ({ room, messages = [] } = {}) => {
  if (room === null || room === undefined) return ''
  const lines = [`房间目标：${room.goal}`]
  const done = doneOf(room).slice(0, DONE_LIMIT)
  if (done.length > 0) lines.push('done：', ...done.map(item => `- ${item}`))
  if ((room.constraints ?? []).length > 0) {
    lines.push('约束：', ...room.constraints.slice(0, CONSTRAINT_LIMIT).map(item => `- ${item}`))
  }
  if (room.projectConstraints?.content) {
    const projectLines = String(room.projectConstraints.content)
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '' && !line.startsWith('#'))
      .slice(0, 12)
    if (projectLines.length > 0) lines.push('项目约束（LODGE.md 快照）：', ...projectLines.map(line => `- ${line}`))
  }
  const feedback = feedbackOf(messages)
  if (feedback.length > 0) lines.push('最近复核：', ...feedback.map(item => `- ${item}`))
  lines.push(`其余在 .crew/rooms/${room.id}/transcript.jsonl（${messages.length} 条），需要时用工具读。`)
  return clip(lines.join('\n'), MAX_CHARS)
}
