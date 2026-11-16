import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs'
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

// GOAL.md 是运行时投影，每次状态变化重写，不是人的编辑对象。
export const writeGoal = room => {
  mkdirSync(roomDir(room), { recursive: true })
  const rootStages = Array.isArray(room.stages) ? room.stages : []
  const stages = rootStages.map((stage, index) => (
    `- [${stage.state}] ${index + 1}. ${stage.title} · ${stage.kind}${stage.acceptance ? ` · 验收：${stage.acceptance}` : ''}${Array.isArray(stage.dependsOn) && stage.dependsOn.length > 0 ? ` · 依赖：阶段 ${stage.dependsOn.map(item => item + 1).join('、')}` : ''}`
  ))
  writeDurable(join(roomDir(room), 'GOAL.md'), [
    '# 目标投影（运行时生成，不是编辑对象）',
    '',
    `目标：${room.goal}`,
    `状态：${room.state}`,
    `仓库：${roomRootOf(room)}`,
    ...(room.seatSpecs?.length > 0
      ? [`成员：${room.seatSpecs.map(seat => `${seat.name}（${seat.role}）`).join(' · ')}`]
      : []),
    '',
    '阶段：',
    ...stages,
    '',
  ].join('\n'))
}

const seatLabel = (room, id) => room.seatSpecs?.find(seat => seat.id === id)?.name ?? id

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
    ...(room.stages ?? []).map((stage, index) => (
      `- 阶段 ${index + 1} ${stage.title}：${stage.kind === 'deliverable' ? '按证据验收' : '人确认'}`
    )),
    '',
  ].join('\n'))
}
