import { homedir } from 'node:os'

export const HANDOFF_FORMAT = 'lodge.room-handoff.v1'

const NAMED_FILES = ['BRIEF.md', 'GOAL.md', 'CONCLUSION.md', 'decisions.md', 'transcript.jsonl', 'events.jsonl', 'usage.jsonl']

// 交接包要能离开本机：房间、席位、临时目录的绝对路径都换成占位符。
const redactionPairs = (room, workspaceRoot) => [
  [room.repoPath, '（房间工作区）'],
  [room.sourceRepo, '（源仓库）'],
  ...Object.values(room.worktrees ?? {}).map(path => [path, '（席位工作区）']),
  [workspaceRoot, '（工作区根）'],
  [homedir(), '~'],
]
  .filter(([path]) => typeof path === 'string' && path !== '')
  .sort((a, b) => b[0].length - a[0].length)

const redact = (text, pairs) => pairs.reduce((out, [path, replacement]) => out.split(path).join(replacement), text)

const handoffRoom = room => ({
  id: room.id,
  name: room.name,
  goal: room.goal,
  state: room.state,
  trust: room.trust ?? 'verify',
  templateId: room.templateId ?? null,
  independence: room.independence ?? null,
  plan: room.plan ?? null,
  stages: room.stages,
  constraints: room.constraints ?? [],
  seats: (room.seatSpecs ?? []).map(({ id, name, title, role, station, permissions, writeScope, toolSurface, skills, mcp, approval, speakBudget }) => ({
    id, name, title, role, station, permissions, writeScope, toolSurface, skills, mcp, approval, speakBudget,
  })),
  seatNames: room.seatNames ?? {},
  leadSeat: room.leadSeat ?? null,
  workers: room.workers ?? [],
  verifiers: room.verifiers ?? [],
  branch: room.branch ?? '',
  branches: room.branches ?? {},
  engines: room.engines ?? {},
  engineFallbacks: room.engineFallbacks ?? {},
  usage: room.usage ?? {},
  workspace: room.workspace ?? null,
})

export const buildHandoff = (room, { handoffStore, workspaceRoot }) => {
  const files = handoffStore.read(room, NAMED_FILES)
  if (files['transcript.jsonl'] === undefined) return null
  const pairs = redactionPairs(room, workspaceRoot)
  return {
    format: HANDOFF_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    room: handoffRoom(room),
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, redact(text, pairs)])),
    redactions: ['本机绝对路径已替换为占位符'],
  }
}
