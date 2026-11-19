const stageLine = (stage, index) => `${index + 1}. ${stage.title} · ${stage.state}`

export const progressOf = (room, messages = []) => {
  const stages = (room?.stages ?? []).map((stage, index) => ({
    index,
    title: typeof stage.title === 'string' ? stage.title : `第 ${index + 1} 步`,
    state: stage.state ?? 'pending',
  }))
  const done = stages.filter(stage => stage.state === 'passed')
  const remaining = stages.filter(stage => stage.state !== 'passed')
  const active = stages.find(stage => stage.state === 'active') ?? null
  const latest = [...messages].reverse().find(message => (
    message.kind === 'evidence' || message.kind === 'verdict'
  )) ?? null
  return {
    goal: typeof room?.goal === 'string' ? room.goal : '',
    state: typeof room?.state === 'string' ? room.state : '',
    active,
    next: active?.title ?? remaining[0]?.title ?? null,
    done,
    remaining,
    lastEvidence: latest === null ? null : {
      kind: latest.kind,
      text: String(latest.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
      at: latest.ts ?? null,
    },
    updatedAt: typeof room?.lastProgressAt === 'number' ? room.lastProgressAt : null,
  }
}

export const progressMarkdownOf = progress => [
  '# 房间进度',
  '',
  `目标：${progress.goal}`,
  `状态：${progress.state}`,
  '',
  '## 已完成',
  ...(progress.done.length === 0 ? ['- 还没有完成项'] : progress.done.map((stage, index) => `- ${stageLine(stage, stage.index)}`)),
  '',
  '## 还剩',
  ...(progress.remaining.length === 0 ? ['- 全部完成'] : progress.remaining.map(stage => `- ${stageLine(stage, stage.index)}`)),
  '',
  `下一步：${progress.next ?? '等你决定'}`,
  progress.lastEvidence === null ? '' : `最近证据：${progress.lastEvidence.text}`,
].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n').trim() + '\n'
