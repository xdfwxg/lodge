import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { roomDir, workspaceRoot } from './paths.js'

export const HANDOFF_FORMAT = 'lodge.room-handoff.v1'

const NAMED_FILES = ['BRIEF.md', 'GOAL.md', 'CONCLUSION.md', 'decisions.md', 'transcript.jsonl', 'events.jsonl', 'usage.jsonl']
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const MAX_FILES = 500
const MAX_MESSAGES = 20_000
const STAGE_KINDS = new Set(['deliverable', 'decision'])
const STAGE_STATES = new Set(['active', 'passed', 'pending'])

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value, limit) => typeof value === 'string' && value.length <= limit

const allowedFile = name => (
  NAMED_FILES.includes(name) ||
  /^evidence\/[\w-]+\.json$/.test(name)
)

const readRoomFiles = room => {
  const dir = roomDir(room)
  const files = {}
  for (const name of NAMED_FILES) {
    const file = join(dir, name)
    if (existsSync(file)) files[name] = readFileSync(file, 'utf8')
  }
  const evidenceDir = join(dir, 'evidence')
  if (existsSync(evidenceDir)) {
    for (const name of readdirSync(evidenceDir).sort()) {
      if (!/^[\w-]+\.json$/.test(name)) continue
      files[`evidence/${name}`] = readFileSync(join(evidenceDir, name), 'utf8')
    }
  }
  return files
}

// 交接包要能离开本机：房间、席位、临时目录的绝对路径都换成占位符。
const redactionPairs = room => [
  [room.repoPath, '（房间工作区）'],
  [room.sourceRepo, '（源仓库）'],
  ...Object.values(room.worktrees ?? {}).map(path => [path, '（席位工作区）']),
  [workspaceRoot(), '（工作区根）'],
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

export const buildHandoff = room => {
  const files = readRoomFiles(room)
  if (files['transcript.jsonl'] === undefined) return null
  const pairs = redactionPairs(room)
  return {
    format: HANDOFF_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    room: handoffRoom(room),
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, redact(text, pairs)])),
    redactions: ['本机绝对路径已替换为占位符'],
  }
}

const parseTranscript = text => {
  const messages = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    if (messages.length >= MAX_MESSAGES) return null
    let message = null
    try {
      message = JSON.parse(line)
    } catch {
      return null
    }
    if (!isRecord(message) || typeof message.id !== 'string' || message.id === '' || typeof message.kind !== 'string') return null
    messages.push(message)
  }
  return messages
}

const handoffWorkspace = value => {
  if (!isRecord(value)) return null
  if (value.provider !== 'git' && value.provider !== 'plain' && value.provider !== 'direct') return null
  return {
    provider: value.provider,
    ...(isRecord(value.capabilities) ? { capabilities: value.capabilities } : {}),
  }
}

const importRoomFrom = meta => ({
  id: '',
  kind: 'room',
  name: meta.name.trim(),
  goal: meta.goal,
  state: meta.state === 'complete' ? 'complete' : 'stopped',
  templateId: meta.templateId ?? null,
  independence: meta.independence ?? null,
  plan: meta.plan ?? null,
  stages: meta.stages,
  constraints: Array.isArray(meta.constraints) ? meta.constraints.filter(text => typeof text === 'string') : [],
  seatSpecs: Array.isArray(meta.seats) ? meta.seats : [],
  seatNames: isRecord(meta.seatNames) ? meta.seatNames : {},
  leadSeat: typeof meta.leadSeat === 'string' ? meta.leadSeat : null,
  workers: Array.isArray(meta.workers) ? meta.workers : [],
  verifiers: Array.isArray(meta.verifiers) ? meta.verifiers : [],
  branch: typeof meta.branch === 'string' ? meta.branch : '',
  branches: isRecord(meta.branches) ? meta.branches : {},
  engines: isRecord(meta.engines) ? meta.engines : {},
  engineFallbacks: isRecord(meta.engineFallbacks) ? meta.engineFallbacks : {},
  usage: isRecord(meta.usage) ? meta.usage : {},
  workspace: handoffWorkspace(meta.workspace),
  imported: true,
  readOnly: true,
  live: false,
  demo: false,
  idle: false,
  busy: false,
  round: 0,
  noProgress: 0,
  seatCursors: {},
  openQuestion: null,
  version: 1,
})

export const importHandoff = ({ store, dataDir, bundle }) => {
  if (!isRecord(bundle)) return { ok: false, reason: 'invalid', error: '交接包不是有效的 JSON 对象' }
  if (bundle.format !== HANDOFF_FORMAT) return { ok: false, reason: 'invalid', error: '不是 Lodge 房间交接包' }
  if (bundle.version !== 1) return { ok: false, reason: 'invalid', error: '交接包版本不支持' }
  const meta = bundle.room
  if (!isRecord(meta)) return { ok: false, reason: 'invalid', error: '交接包缺少房间信息' }
  if (!isText(meta.name, 200) || meta.name.trim() === '') return { ok: false, reason: 'invalid', error: '交接包缺少房间名' }
  if (!isText(meta.goal, 2000) || meta.goal.trim() === '') return { ok: false, reason: 'invalid', error: '交接包缺少目标' }
  if (!Array.isArray(meta.stages) || meta.stages.length === 0 || meta.stages.length > 50) {
    return { ok: false, reason: 'invalid', error: '交接包的阶段不可用' }
  }
  const stages = []
  for (const stage of meta.stages) {
    if (!isRecord(stage) || !isText(stage.title, 200) || !STAGE_KINDS.has(stage.kind) || !STAGE_STATES.has(stage.state)) {
      return { ok: false, reason: 'invalid', error: '交接包里有不可用的阶段' }
    }
    if (stage.acceptance !== undefined && !isText(stage.acceptance, 500)) {
      return { ok: false, reason: 'invalid', error: '交接包里的验收命令不可用' }
    }
    stages.push({
      title: stage.title,
      kind: stage.kind,
      state: stage.state,
      ...(stage.acceptance === undefined ? {} : { acceptance: stage.acceptance }),
      ...(stage.manual === true ? { manual: true } : {}),
    })
  }
  if (!isRecord(bundle.files)) return { ok: false, reason: 'invalid', error: '交接包缺少文件' }
  const entries = Object.entries(bundle.files)
  if (entries.length > MAX_FILES) return { ok: false, reason: 'invalid', error: '交接包里的文件太多' }
  let total = 0
  for (const [name, text] of entries) {
    if (!allowedFile(name)) return { ok: false, reason: 'invalid', error: `交接包含不支持的文件：${name}` }
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_FILE_BYTES) {
      return { ok: false, reason: 'invalid', error: `交接包文件不可用：${name}` }
    }
    total += Buffer.byteLength(text)
    if (total > MAX_TOTAL_BYTES) return { ok: false, reason: 'invalid', error: '交接包超过大小上限' }
  }
  const messages = parseTranscript(bundle.files['transcript.jsonl'] ?? '')
  if (messages === null) return { ok: false, reason: 'invalid', error: '交接包的 transcript.jsonl 不可解析' }
  if (messages.length === 0) return { ok: false, reason: 'invalid', error: '交接包里没有对话记录' }
  const seenIds = new Set()
  for (const message of messages) {
    if (seenIds.has(message.id)) return { ok: false, reason: 'invalid', error: '交接包里有重复的消息 ID' }
    seenIds.add(message.id)
    if (store.hasMessageId(message.id)) {
      return { ok: false, reason: 'conflict', error: '这个交接包已经导入过（消息 ID 已存在）' }
    }
  }

  const id = `room-import-${randomUUID().slice(0, 8)}`
  const archive = join(dataDir, 'imported', id)
  const room = { ...importRoomFrom(meta), id, stages, repoPath: archive }
  const dir = roomDir(room)
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of entries) {
    const file = join(dir, name)
    mkdirSync(name.includes('/') ? join(dir, 'evidence') : dir, { recursive: true })
    writeFileSync(file, text)
  }
  const stored = store.importRoom({ room, messages })
  if (stored === null) return { ok: false, reason: 'conflict', error: '房间 ID 已存在' }
  store.appendEvent(id, 'room.imported', {
    from: typeof meta.id === 'string' ? meta.id : null,
    files: entries.length,
    messages: messages.length,
  })
  return { ok: true, room: store.readRoom(id) ?? room }
}
