import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { independenceLabel } from './digest.js'
import { progressMarkdownOf, progressOf } from '../../shared/progress.js'
import { roomDir, roomRootOf } from './paths.js'
import { ensureDirInside } from './workspace-paths.js'
import { memberName, workerIds } from './room-members.js'

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
  const dir = ensureDirInside(roomRootOf(room), roomDir(room))
  const fd = openSync(join(dir, 'transcript.jsonl'), 'a')
  try {
    writeSync(fd, `${JSON.stringify(message)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

// transcript 是崩溃恢复日志与可读镜像；SQLite 才是房间、消息和交接的真相。
export const readTranscript = room => {
  const file = join(roomDir(room), 'transcript.jsonl')
  if (!existsSync(file)) return []
  const messages = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const message = JSON.parse(line)
      if (typeof message?.id === 'string' && message.id !== '') messages.push(message)
    } catch {}
  }
  return messages
}

// 治理事件镜像：clone 房间时不只拿讨论，也拿阶段、复核、审批与提交的轨迹。
export const appendEventLog = (room, event) => {
  const dir = ensureDirInside(roomRootOf(room), roomDir(room))
  const fd = openSync(join(dir, 'events.jsonl'), 'a')
  try {
    writeSync(fd, `${JSON.stringify(event)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

// 每次执行一份可读诊断：回合、工具、用量、终止去向；只落本地 .crew，不参与交付。
export const writeDiagnostic = (room, turnId, payload) => {
  const dir = ensureDirInside(roomRootOf(room), join(roomDir(room), 'diagnostics'))
  const name = String(turnId ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'turn'
  const file = join(dir, `${name}.json`)
  writeDurable(file, `${JSON.stringify(payload, null, 2)}\n`)
  return file
}

export const readEventLog = room => {
  const file = join(roomDir(room), 'events.jsonl')
  if (!existsSync(file)) return []
  const events = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const event = JSON.parse(line)
      if (typeof event?.id === 'string' && event.id !== '') events.push(event)
    } catch {}
  }
  return events
}

export const writeEvidence = (room, message) => {
  const dir = ensureDirInside(roomRootOf(room), join(roomDir(room), 'evidence'))
  writeDurable(join(roomDir(room), message.meta.evidenceRef), JSON.stringify(message.meta, null, 2))
}

// GOAL.md 是运行时投影，每次状态变化重写，不是人的编辑对象。
export const writeGoal = room => {
  ensureDirInside(roomRootOf(room), roomDir(room))
  const rootStages = Array.isArray(room.stages) ? room.stages : []
  const stages = rootStages.map((stage, index) => (
    `- [${stage.state}] ${index + 1}. ${stage.title} · ${stage.kind}${stage.deliverable ? ` · 交付：${stage.deliverable}` : ''}${Array.isArray(stage.dependsOn) && stage.dependsOn.length > 0 ? ` · 依赖：阶段 ${stage.dependsOn.map(item => item + 1).join('、')}` : ''}`
  ))
  writeDurable(join(roomDir(room), 'GOAL.md'), [
    '# 目标投影（运行时生成，不是编辑对象）',
    '',
    `目标：${room.goal}`,
    `状态：${room.state}`,
    `仓库：${roomRootOf(room)}`,
    ...(room.members?.length > 0
      ? [`成员：${room.members.map(member => `${member.name}（${member.role}）`).join(' · ')}`]
      : []),
    '',
    '阶段：',
    ...stages,
    '',
  ].join('\n'))
}


// 每个房间一份紧凑进度，供下一次 run 接续；完整过程仍在 transcript。
export const writeProgress = (room, messages = []) => {
  ensureDirInside(roomRootOf(room), roomDir(room))
  const file = join(roomDir(room), 'progress.md')
  writeDurable(file, progressMarkdownOf(progressOf(room, messages)))
  return file
}

// 完成结论是运行时投影；decisions.md 归人，运行时不写。
export const writeConclusion = room => {
  ensureDirInside(roomRootOf(room), roomDir(room))
  writeDurable(join(roomDir(room), 'CONCLUSION.md'), [
    `# 结论：${room.goal}`,
    '',
    `- 完成时间：${new Date().toISOString()}`,
    `- 独立性：${independenceLabel(room)}`,
    `- 目标仓库：${roomRootOf(room)}`,
    ...(typeof room.sourceRepo === 'string' && room.sourceRepo !== '' ? [`- 源仓库：${room.sourceRepo}`] : []),
    `- 交付分支：${room.branch || '(无分支)'}`,
    ...(workerIds(room).length > 1
      ? [`- 并行候选：${workerIds(room).map(worker => `${memberName(room, worker)} → ${room.branches?.[worker] ?? '(无分支)'}`).join('；')}`]
      : []),
    '',
    '## 阶段与验收',
    ...(room.stages ?? []).map((stage, index) => (
      `- 阶段 ${index + 1} ${stage.title}：${stage.kind === 'deliverable' ? '按证据验收' : '人确认'}`
    )),
    '',
  ].join('\n'))
}
