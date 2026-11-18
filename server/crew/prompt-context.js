// 上下文装配：事实优先（BRIEF/阶段/证据），聊天只补还没进记录的新信息。
// 三问自检：现在做什么、为什么这么做、怎么算完成；答不出的事实不能裁。
import { verdictPassed } from '../../shared/judgment.js'
import { sanitizeUntrusted } from '../../shared/untrusted-text.js'
export const CONTEXT_BUDGET = {
  recent: 2_000,
  older: 1_000,
  evidence: 800,
}

const clip = (text, limit) => sanitizeUntrusted(String(text ?? '').replace(/\s+/g, ' ').trim(), limit)

// 最近 N 条保留原文，更早的缩成一行；从新往旧装预算，装不下就停。
export const recentAndOlder = (
  messages,
  { nameOf = message => message.authorId ?? '成员', recent = 4, recentChars = 300, olderChars = 80, budget = CONTEXT_BUDGET.recent + CONTEXT_BUDGET.older } = {},
) => {
  const items = (Array.isArray(messages) ? messages : []).map((message, index) => ({
    index,
    message,
    recent: index >= messages.length - recent,
  }))
  let remaining = budget
  const kept = []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    const limit = item.recent ? recentChars : olderChars
    const line = `${nameOf(item.message)}：${clip(item.message.text, limit)}`
    if (line.length > remaining) break
    remaining -= line.length
    kept.unshift(line)
  }
  return kept
}

// 历史阶段只留状态和最后一次 verdict，不复述过程。
export const stageDigest = (room, messages, { budget = 300 } = {}) => {
  const verdicts = (Array.isArray(messages) ? messages : []).filter(message => message.kind === 'verdict')
  const lines = (room?.stages ?? []).map((stage, index) => {
    const last = verdicts.filter(message => (message.meta?.stage ?? 0) === index).at(-1)
    const result = last === undefined ? '' : ` · ${verdictPassed(last) ? 'PASS' : 'REJECT'}`
    return `${index + 1}. ${sanitizeUntrusted(stage.title, 120)} · ${stage.state}${result}`
  })
  let remaining = budget
  const kept = []
  for (const line of lines) {
    if (line.length > remaining) break
    remaining -= line.length
    kept.push(line)
  }
  return kept
}

export const evidenceDigest = (messages, { budget = CONTEXT_BUDGET.evidence } = {}) => {
  const lines = (Array.isArray(messages) ? messages : [])
    .filter(message => message.kind === 'evidence')
    .map(message => {
      const meta = message.meta ?? {}
      const stage = Number.isInteger(meta.stage) ? `阶段 ${meta.stage + 1} · ` : ''
      const command = typeof meta.command === 'string' && meta.command !== '' ? sanitizeUntrusted(meta.command, 160) : '人工结果'
      const exit = meta.exit === null || meta.exit === undefined ? '' : ` · exit ${meta.exit}`
      const files = Array.isArray(meta.changedFiles) && meta.changedFiles.length > 0
        ? ` · ${meta.changedFiles.slice(0, 4).map(file => sanitizeUntrusted(file, 120)).join('、')}`
        : ''
      return `${stage}${command}${exit}${files}`
    })
  let remaining = budget
  const kept = []
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].length > remaining) break
    remaining -= lines[index].length
    kept.unshift(lines[index])
  }
  return kept
}
