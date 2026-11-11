import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { independenceLabel } from './digest.js'
import { roomDir, roomRootOf } from './paths.js'

export { roomDir }

const writeDurable = (file, content) => {
  const fd = openSync(file, 'w')
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

// transcript.jsonl 是持久日志：先追加并 fsync，再提交 SQLite。
export const appendTranscript = (room, message) => {
  const dir = roomDir(room)
  mkdirSync(dir, { recursive: true })
  const fd = openSync(join(dir, 'transcript.jsonl'), 'a')
  try {
    writeSync(fd, `${JSON.stringify(message)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

// 治理事件镜像：clone 房间时不只拿讨论，也拿阶段、复核、审批与提交的轨迹。
export const appendEventLog = (room, event) => {
  const dir = roomDir(room)
  mkdirSync(dir, { recursive: true })
  const fd = openSync(join(dir, 'events.jsonl'), 'a')
  try {
    writeSync(fd, `${JSON.stringify(event)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export const writeEvidence = (room, message) => {
  const dir = join(roomDir(room), 'evidence')
  mkdirSync(dir, { recursive: true })
  writeDurable(join(roomDir(room), message.meta.evidenceRef), JSON.stringify(message.meta, null, 2))
}

const briefText = (room, plan = null) => {
  const done = plan?.done?.length > 0
    ? plan.done.map(text => `- [ ] ${text}`)
    : room.stages.map((stage, index) => (
      `- [${stage.state === 'passed' ? 'x' : ' '}] 阶段 ${index + 1}：${stage.title}${stage.kind === 'deliverable' ? '（交付型 · 需证据）' : '（决策型 · 需人确认）'}`
    ))
  const confirmed = (plan?.answers ?? []).map(item => `已确认：${item.question} → ${item.answer}`)
  const constraints = [...new Set([
    ...confirmed,
    ...(plan?.why ? [`编制理由：${plan.why}`] : []),
    ...(room.constraints ?? []),
    '决策型阶段必须由人点过，不能由模型代点',
    '交付型阶段必须在本阶段有证据落盘（证据在 evidence/，与 transcript 同一份真相）',
    ...(room.verifiers?.length > 0
      ? ['验收由验收席位独立复核，最终由人签字']
      : ['验收由你凭证据签字']),
  ])]
  return [
    `# 目标：${room.goal}`,
    '',
    'done:',
    ...done,
    '',
    'constraints:',
    ...constraints.map(text => `- ${text}`),
    '',
  ].join('\n')
}

// BRIEF.md 归人：只在不存在时给一份初稿，之后运行时绝不改写。
export const writeBrief = (room, plan = null) => {
  const file = join(roomDir(room), 'BRIEF.md')
  if (existsSync(file)) return false
  mkdirSync(roomDir(room), { recursive: true })
  writeFileSync(file, briefText(room, plan))
  return true
}

// GOAL.md 是运行时投影，每次状态变化重写，不是人的编辑对象。
export const writeGoal = room => {
  mkdirSync(roomDir(room), { recursive: true })
  const stages = room.stages.map((stage, index) => (
    `- [${stage.state}] ${index + 1}. ${stage.title} · ${stage.kind}${stage.acceptance ? ` · 验收：${stage.acceptance}` : ''}`
  ))
  writeDurable(join(roomDir(room), 'GOAL.md'), [
    '# 目标投影（运行时生成，不是编辑对象）',
    '',
    `目标：${room.goal}`,
    `状态：${room.state}`,
    `仓库：${roomRootOf(room)}`,
    ...(room.seatSpecs?.length > 0
      ? [`席位：${room.seatSpecs.map(seat => `${seat.name}（${seat.role}）`).join(' · ')}`]
      : room.seatNames === undefined ? [] : [
        `席位：队长 ${room.seatNames.planner ?? '—'} · 执行 ${room.seatNames.executor ?? '—'} · 验收 ${room.seatNames.verifier ?? '—'}`,
      ]),
    '',
    '阶段：',
    ...stages,
    '',
  ].join('\n'))
}

export const readBrief = room => {
  const file = join(roomDir(room), 'BRIEF.md')
  if (!existsSync(file)) return null
  const lines = readFileSync(file, 'utf8').split('\n')
  const objective = (lines.find(line => line.startsWith('# 目标')) ?? '').replace(/^#\s*目标[:：]\s*/, '')
  const section = name => {
    const start = lines.findIndex(line => line.trim() === `${name}:`)
    if (start < 0) return []
    const out = []
    for (const line of lines.slice(start + 1)) {
      if (/^[a-z_]+:\s*$/i.test(line)) break
      if (line.startsWith('- ')) out.push(line.slice(2).trim())
    }
    return out
  }
  return {
    objective,
    done: section('done').map(text => {
      const checked = text.match(/^\[( |x)\]\s*(.*)$/i)
      return checked ? { done: checked[1].toLowerCase() === 'x', text: checked[2] } : { done: false, text }
    }),
    constraints: section('constraints'),
  }
}

const seatLabel = (room, id) => (
  room.seatSpecs?.find(seat => seat.id === id)?.name ?? room.seatNames?.[id] ?? id
)

// 完成结论是运行时投影；decisions.md 归人，运行时不写。
export const writeConclusion = room => {
  mkdirSync(roomDir(room), { recursive: true })
  writeDurable(join(roomDir(room), 'CONCLUSION.md'), [
    `# 结论：${room.goal}`,
    '',
    `- 完成时间：${new Date().toISOString()}`,
    `- 独立性：${independenceLabel(room)}`,
    `- 目标仓库：${roomRootOf(room)}`,
    ...(typeof room.sourceRepo === 'string' && room.sourceRepo !== '' ? [`- 源仓库：${room.sourceRepo}`] : []),
    `- 交付分支：${room.branch || '(无分支)'}`,
    ...(room.workers?.length > 1
      ? [`- 并行候选：${room.workers.map(worker => `${seatLabel(room, worker)} → ${room.branches?.[worker] ?? '(无分支)'}`).join('；')}`]
      : []),
    '',
    '## 阶段与验收',
    ...room.stages.map((stage, index) => (
      `- 阶段 ${index + 1} ${stage.title}：${stage.kind === 'deliverable' ? '按证据验收' : '人确认'}`
    )),
    '',
  ].join('\n'))
}
