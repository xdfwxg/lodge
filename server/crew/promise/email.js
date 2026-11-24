import { artifactKindOf } from '../../../shared/artifact.js'

const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value !== ''))]
const dateText = ts => {
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const artifactPathsOf = messages => unique(messages.flatMap(message => (
  (message.meta?.artifacts ?? []).map(artifact => artifact?.path)
)))

export const emailWorthSending = promise => (
  promise?.delivery?.channel === 'email' &&
  !(promise.delivery.mode === 'changes' && promise.lastChange === 'no')
)

// 邮件正文先是结果本身：优先发这次产出的文本，其次发结论；文件路径始终附上。
// 不把整段自由文本交给模型，也不在这里复制工作室的交付投影。
export const emailOf = ({ room, promise, roundId = null, messages = [], readArtifact = null }) => {
  const goal = String(promise.text ?? room.goal ?? room.name ?? '').trim()
  const conclusion = [...messages].reverse().find(message => (
    message.kind === 'conclusion' &&
    (roundId === null || message.meta?.roundId === undefined || message.meta.roundId === roundId)
  ))?.text ?? ''
  const artifacts = artifactPathsOf(messages)
  const textPath = artifacts.find(path => ['document', 'text'].includes(artifactKindOf(path)))
  let content = ''
  if (textPath !== undefined && typeof readArtifact === 'function') {
    try { content = String(readArtifact(textPath) ?? '').trim() } catch { content = '' }
  }
  const usefulConclusion = conclusion.startsWith('已交付：') ? '' : conclusion.trim()
  const body = [
    goal === '' ? '' : `目标：${goal}`,
    content !== '' ? content : usefulConclusion,
    artifacts.length === 0 ? '' : `文件：\n${artifacts.join('\n')}`,
  ].filter(Boolean).join('\n\n')
  const name = String(room.name ?? room.goal ?? 'Lodge').trim().slice(0, 80)
  return {
    to: String(promise.delivery?.to ?? '').trim(),
    subject: `${name} · ${dateText(Date.now())}`,
    text: body,
    roundId,
  }
}
