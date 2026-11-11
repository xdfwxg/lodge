import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildHandoff } from '../server/crew/handoff.js'
import { roomDir } from '../server/crew/paths.js'
import { sanitizeHandoff } from '../server/crew/sanitize.js'
import { ROOM_SEEDS } from '../server/crew/seeds.js'

const BASE = Date.UTC(2026, 10, 12, 9, 0, 0)
const OUT = resolve('examples/rooms')
const GIT_CAPABILITIES = {
  vcs: 'git',
  isolation: 'worktree',
  diff: 'patch',
  candidate: true,
  merge: true,
  commit: true,
  acceptanceCopy: true,
}

const brief = room => [
  `# 目标：${room.goal}`,
  '',
  'done:',
  ...room.stages.map(stage => `- [${stage.state === 'passed' ? 'x' : ' '}] ${stage.title}`),
  '',
  'constraints:',
  '- 这是模拟样本，用来演示房间记录、目标岛与交接包；不是真实交付',
  '- 交付型阶段必须有命令证据',
  '',
].join('\n')

const goal = room => [
  '# 目标投影（运行时生成，不是编辑对象）',
  '',
  `目标：${room.goal}`,
  `状态：${room.state}`,
  '仓库：（示例仓库）',
  '',
  '阶段：',
  ...room.stages.map((stage, index) => `- [${stage.state}] ${index + 1}. ${stage.title} · ${stage.kind}${stage.acceptance ? ` · 验收：${stage.acceptance}` : ''}`),
  '',
].join('\n')

const conclusion = room => [
  `# 结论：${room.goal}`,
  '',
  `- 完成时间：${new Date(BASE).toISOString()}`,
  '- 独立性：模拟样本',
  '- 目标仓库：（示例仓库）',
  '- 交付分支：（示例分支）',
  '',
  '## 阶段与验收',
  ...room.stages.map((stage, index) => `- 阶段 ${index + 1} ${stage.title}：${stage.kind === 'deliverable' ? '按证据验收' : '人确认'}`),
  '',
].join('\n')

const buildEvents = (room, messages) => {
  const events = [{ type: 'room.created', payload: { live: false, sample: true }, at: BASE - 1_200_000 }]
  for (const message of messages) {
    if (message.kind === 'evidence' && message.meta?.command !== undefined) {
      events.push({
        type: 'acceptance.run',
        payload: { stage: message.meta.stage ?? 0, command: message.meta.command, exit: message.meta.exit, sample: true },
        at: message.ts,
      })
    }
    if (message.kind === 'verdict') {
      events.push({
        type: 'verifier.verdict',
        payload: { stage: message.meta?.stage ?? 0, pass: message.meta?.pass === true, sample: true },
        at: message.ts,
      })
    }
  }
  if (room.state === 'complete') events.push({ type: 'room.complete', payload: { sample: true }, at: BASE })
  return events.map((event, index) => ({ id: `${room.id}-e${index + 1}`, roomId: room.id, ...event }))
}

mkdirSync(OUT, { recursive: true })

for (const seed of ROOM_SEEDS) {
  const repo = mkdtempSync(join(tmpdir(), 'lodge-sample-'))
  const room = {
    ...seed.room,
    demo: false,
    repoPath: repo,
    sourceRepo: '',
    worktrees: {},
    workspace: { provider: 'git', capabilities: GIT_CAPABILITIES },
  }
  const dir = roomDir(room)
  mkdirSync(join(dir, 'evidence'), { recursive: true })

  const messages = seed.messages.map((message, index) => {
    const { at, ...rest } = message
    const id = `${room.id}-m${index + 1}`
    const stored = { ...rest, id, roomId: room.id, seq: index + 1, ts: BASE - at }
    if (stored.kind === 'evidence') {
      stored.meta = {
        ...stored.meta,
        simulated: true,
        sample: true,
        vcs: 'demo',
        evidenceRef: `evidence/${id}.json`,
        capturedAt: new Date(stored.ts).toISOString(),
      }
      writeFileSync(join(dir, 'evidence', `${id}.json`), `${JSON.stringify(stored.meta, null, 2)}\n`)
    }
    return stored
  })
  if (room.state === 'complete') {
    messages.push({
      id: `${room.id}-m${messages.length + 1}`,
      roomId: room.id,
      seq: messages.length + 1,
      kind: 'system',
      ts: BASE,
      text: '目标达成 · 已写入 CONCLUSION.md · 模拟样本不产生 commit',
    })
  }

  writeFileSync(join(dir, 'BRIEF.md'), brief(room))
  writeFileSync(join(dir, 'GOAL.md'), goal(room))
  if (room.state === 'complete') writeFileSync(join(dir, 'CONCLUSION.md'), conclusion(room))
  writeFileSync(join(dir, 'transcript.jsonl'), `${messages.map(message => JSON.stringify(message)).join('\n')}\n`)
  writeFileSync(join(dir, 'events.jsonl'), `${buildEvents(room, messages).map(event => JSON.stringify(event)).join('\n')}\n`)

  const bundle = buildHandoff(room)
  if (bundle === null) throw new Error(`sample bundle failed: ${room.id}`)
  const clean = sanitizeHandoff(bundle)
  clean.exportedAt = new Date(BASE).toISOString()
  clean.sample = {
    kind: 'simulated',
    source: 'server/crew/seeds.js',
    note: '模拟数据，用于演示交接包、目标岛与复盘视图；不是真实交付。',
  }
  writeFileSync(join(OUT, `${room.id}.lodge.json`), `${JSON.stringify(clean, null, 2)}\n`)
  console.log(`sample: ${room.id} · ${clean.redactionCount} redactions`)
  rmSync(repo, { recursive: true, force: true })
}
