// 复盘是只读投影：只从房间状态、消息与证据派生，不写任何新真相。
const number = value => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const parseJson = text => {
  if (typeof text !== 'string' || text.trim() === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const tokensOf = usage => {
  if (usage === null || typeof usage !== 'object') return null
  const input = number(usage.input) ?? number(usage.prompt_tokens) ?? number(usage.promptTokens)
  const output = number(usage.output) ?? number(usage.completion_tokens) ?? number(usage.completionTokens)
  const cachedInput = number(usage.cachedInput) ?? number(usage.cached_input) ?? 0
  if (input === null && output === null) return null
  return { input: input ?? 0, output: output ?? 0, cachedInput, total: (input ?? 0) + (output ?? 0) }
}

const usageOf = message => {
  const parsed = parseJson(message.meta?.output)
  return message.meta?.usage ?? parsed?.usage ?? parsed?.turn?.usage ?? null
}

const toolsOf = message => {
  const parsed = parseJson(message.meta?.output)
  return Array.isArray(parsed?.tools) ? parsed.tools : []
}

const failureText = message => {
  if (message.kind === 'rework') return message.text || '你要求重做'
  if (message.kind === 'verdict' && message.meta?.pass === false) return message.text || '验收席位打回'
  if (message.kind === 'evidence' && message.meta?.kind === 'command' && message.meta.exit !== 0) {
    return `验收命令 \`${message.meta.command ?? '命令'}\` · exit ${message.meta.exit ?? '无'}`
  }
  if (message.kind === 'system' && /失败|冲突|超时|未执行|没有产出/.test(message.text ?? '')) return message.text
  return null
}

export const buildReview = (room, messages = []) => {
  const ordered = [...messages].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const stages = room.stages.map((stage, index) => {
    const stageMessages = ordered.filter(message => (message.meta?.stage ?? 0) === index)
    const verdicts = stageMessages.filter(message => message.kind === 'verdict')
    const evidence = stageMessages.filter(message => message.kind === 'evidence' && message.meta?.kind === 'command')
    return {
      index,
      title: stage.title,
      kind: stage.kind,
      state: stage.state,
      acceptance: stage.acceptance ?? null,
      rejects: verdicts.filter(message => message.meta?.pass === false).length +
        stageMessages.filter(message => message.kind === 'rework').length,
      passes: verdicts.filter(message => message.meta?.pass === true).length,
      commands: evidence.length,
      failed: evidence.filter(message => message.meta?.exit !== 0).length,
      partial: stage.partial ?? null,
      tasks: stage.tasks ?? [],
    }
  })

  const tokens = { input: 0, output: 0, cachedInput: 0, total: 0 }
  let tokenMessages = 0
  const tools = new Map()
  for (const message of ordered) {
    if (message.kind !== 'evidence') continue
    const usage = tokensOf(usageOf(message))
    if (usage !== null) {
      tokenMessages += 1
      tokens.input += usage.input
      tokens.output += usage.output
      tokens.cachedInput += usage.cachedInput
      tokens.total += usage.total
    }
    for (const tool of toolsOf(message)) {
      const name = typeof tool?.name === 'string' ? tool.name : '工具'
      const current = tools.get(name) ?? { name, count: 0, failed: 0 }
      current.count += number(tool.count) ?? 0
      current.failed += number(tool.failed) ?? 0
      tools.set(name, current)
    }
  }

  const failures = ordered
    .map(message => ({ message, text: failureText(message) }))
    .filter(item => item.text !== null)
    .sort((a, b) => (b.message.seq ?? 0) - (a.message.seq ?? 0))
    .slice(0, 12)
    .map(({ message, text }) => ({
      id: message.id,
      kind: message.kind === 'verdict' ? 'rework' : message.kind === 'evidence' ? 'command' : 'system',
      stage: message.meta?.stage ?? null,
      text,
      at: message.ts ?? null,
    }))

  const commandEvidence = ordered.filter(message => message.kind === 'evidence' && message.meta?.kind === 'command')
  return {
    roomId: room.id,
    name: room.name,
    goal: room.goal,
    state: room.state,
    usage: {
      costMicroUsd: room.usage?.costMicroUsd ?? 0,
      budgetMicroUsd: room.usage?.budgetMicroUsd ?? 0,
      turns: room.usage?.turns ?? 0,
      tokens: tokenMessages === 0 ? null : tokens,
      tokenMessages,
    },
    stages,
    rework: {
      total: stages.reduce((sum, stage) => sum + stage.rejects, 0),
      byStage: stages.filter(stage => stage.rejects > 0).map(stage => ({ index: stage.index, title: stage.title, count: stage.rejects })),
    },
    evidence: {
      commands: commandEvidence.length,
      passed: commandEvidence.filter(message => message.meta?.exit === 0).length,
      failed: commandEvidence.filter(message => message.meta?.exit !== 0).length,
    },
    tools: [...tools.values()].sort((a, b) => b.count - a.count),
    failures,
    span: {
      startedAt: ordered[0]?.ts ?? null,
      updatedAt: ordered.at(-1)?.ts ?? null,
    },
  }
}
