import { independenceLabel } from './digest.js'
import { evidenceDigest, evidenceEntryFromMessage, verifyEvidenceIntegrity } from './evidence-ledger.js'

const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value !== ''))]

// 有账本就用账本里的存储 digest；没有账本时从消息派生同一份摘要，保证旧调用仍能出交付单。
const ledgerEntriesOf = (messages, ledger) => (
  Array.isArray(ledger)
    ? ledger
    : messages
      .map(evidenceEntryFromMessage)
      .filter(entry => entry !== null)
      .map(entry => ({ ...entry, digest: evidenceDigest(entry) }))
)

const artifactList = (messages, roots = []) => {
  const normalizedRoots = roots.filter(root => typeof root === 'string' && root !== '').map(root => root.replace(/\/$/, ''))
  const byPath = new Map()
  for (const message of messages) {
    for (const artifact of message.meta?.artifacts ?? []) {
      if (artifact === null || typeof artifact !== 'object' || typeof artifact.path !== 'string' || artifact.path === '') continue
      if (normalizedRoots.length > 0 && !normalizedRoots.some(root => artifact.path === root || artifact.path.startsWith(`${root}/`))) continue
      byPath.set(artifact.path, {
        path: artifact.path,
        bytes: Number.isFinite(artifact.bytes) ? artifact.bytes : null,
      })
    }
  }
  return [...byPath.values()]
}

// 完成态交付单只读投影：目标、阶段、命令、改动文件、结论与 commit。
export const buildDelivery = (room, messages = [], ledger = null) => {
  const entries = ledgerEntriesOf(messages, ledger)
  const entriesById = new Map(entries.map(entry => [entry.id, entry]))
  const stages = room.stages.map((stage, index) => {
    const stageMessages = messages.filter(message => (message.meta?.stage ?? 0) === index)
    const commands = stageMessages
      .filter(message => message.kind === 'evidence' && message.meta?.kind === 'command')
      .filter(message => !/^manual$/i.test(String(message.meta?.command ?? '').trim()))
      .map(message => ({
        id: message.id,
        command: message.meta?.command ?? '',
        exit: message.meta?.exit ?? null,
        evidenceId: message.id,
        digest: entriesById.get(message.id)?.digest ?? null,
        changedFiles: Array.isArray(message.meta?.changedFiles) ? message.meta.changedFiles : [],
        simulated: message.meta?.simulated === true,
      }))
    const verdicts = stageMessages
      .filter(message => message.kind === 'verdict')
      .map(message => ({
        id: message.id,
        authorId: message.authorId ?? 'verifier',
        pass: message.meta?.pass === true,
        text: message.text ?? '',
        evidenceId: message.meta?.evidenceId ?? null,
      }))
    const manual = stageMessages.find(message => message.kind === 'evidence' && message.meta?.kind === 'manual')
    return {
      index,
      title: stage.title,
      kind: stage.kind,
      state: stage.state,
      acceptance: stage.acceptance ?? null,
      commands,
      manual: manual === undefined ? null : {
        id: manual.id,
        text: manual.text ?? '',
        digest: entriesById.get(manual.id)?.digest ?? null,
      },
      verdicts,
      changedFiles: unique(commands.flatMap(command => command.changedFiles)),
    }
  })
  const commands = stages.flatMap(stage => stage.commands)
  const changedFiles = unique(stages.flatMap(stage => stage.changedFiles))
  const lastAt = messages.reduce((latest, message) => Math.max(latest, message.ts ?? 0), 0)
  const delivery = {
    roomId: room.id,
    name: room.name,
    goal: room.goal,
    completedAt: room.completedAt ?? (lastAt > 0 ? lastAt : null),
    commit: typeof room.completedCommit === 'string' && room.completedCommit !== '' ? room.completedCommit : null,
    independenceLabel: independenceLabel(room),
    seatNames: room.seatNames ?? {},
    workspace: {
      provider: room.workspace?.provider ?? 'git',
      vcs: room.workspace?.capabilities?.vcs ?? 'none',
    },
    workspacePath: room.repoPath ?? Object.values(room.worktrees ?? {})[0] ?? null,
    sourcePath: room.sourceRepo ?? null,
    artifacts: artifactList(messages, [room.repoPath, ...Object.values(room.worktrees ?? {})]),
    stages,
    commands,
    changedFiles,
    ledger: entries.map(entry => ({
      id: entry.id,
      seq: entry.seq,
      kind: entry.meta?.kind ?? '',
      stage: entry.meta?.stage ?? 0,
      command: entry.meta?.command ?? '',
      exit: entry.meta?.exit ?? null,
      digest: entry.digest ?? '',
      at: entry.at ?? null,
    })),
    integrity: verifyEvidenceIntegrity(entries),
    evidenceCount: stages.reduce((total, stage) => total + stage.commands.length + (stage.manual === null ? 0 : 1), 0),
  }
  return delivery
}

export const deliveryMarkdown = delivery => {
  const lines = [
    `# 交付单：${delivery.name ?? '交付'}`,
    '',
    `目标：${delivery.goal ?? '—'}`,
    `完成时间：${delivery.completedAt === null || delivery.completedAt === undefined ? '未记录' : new Date(delivery.completedAt).toISOString()}`,
    `独立性：${delivery.independenceLabel ?? '未标注'}`,
    `工作区：${delivery.workspace?.provider ?? '—'} / ${delivery.workspace?.vcs ?? '—'}`,
    `改动位置：${delivery.workspacePath ?? '—'}`,
    `原目录：${delivery.sourcePath ?? '—'}`,
    `结论 commit：${delivery.commit ?? '无'}`,
    '',
    '## 阶段',
  ]
  for (const stage of delivery.stages ?? []) {
    lines.push(`### ${stage.index + 1}. ${stage.title}（${stage.kind === 'deliverable' ? '交付' : '决策'}）`)
    if (stage.acceptance) lines.push(`- 验收命令：\`${stage.acceptance}\``)
    for (const command of stage.commands) {
      lines.push(`- 命令：\`${command.command}\` · exit ${command.exit === null ? '无' : command.exit}`)
    }
    for (const verdict of stage.verdicts) {
      const name = delivery.seatNames?.[verdict.authorId] ?? verdict.authorId
      lines.push(`- 复核：${name} · ${verdict.pass ? 'PASS' : 'REJECT'}`)
    }
    if (stage.changedFiles.length > 0) lines.push(`- 改动文件：${stage.changedFiles.join('、')}`)
  }
  lines.push('', '## 证据账本')
  if ((delivery.ledger ?? []).length === 0) {
    lines.push('- 无')
  } else {
    for (const entry of delivery.ledger) {
      const label = entry.kind === 'manual' ? '人工产物' : entry.command || '命令'
      lines.push(`- #${entry.seq} · 阶段 ${entry.stage + 1} · ${label} · exit ${entry.exit === null ? '无' : entry.exit} · digest ${entry.digest || '缺失'}`)
    }
  }
  const integrity = delivery.integrity ?? { total: 0, verified: 0, ok: true, broken: [] }
  lines.push('', integrity.ok
    ? `完整性：${integrity.verified}/${integrity.total} 条凭证摘要一致（SHA-256）`
    : `完整性：${integrity.broken.length}/${integrity.total} 条凭证摘要不一致`)
  for (const row of integrity.broken ?? []) {
    lines.push(`- #${row.seq} 存储 ${row.storedDigest || '缺失'} · 重算 ${row.computedDigest}`)
  }
  lines.push('', '## 产出文件')
  lines.push(...(delivery.artifacts ?? []).map(artifact => `- ${artifact.path}`))
  if ((delivery.artifacts ?? []).length === 0) lines.push('- 无')
  lines.push('', '## 改动文件')
  lines.push(...(delivery.changedFiles ?? []).map(file => `- ${file}`))
  if ((delivery.changedFiles ?? []).length === 0) lines.push('- 无')
  lines.push('', '> 由 Lodge 从房间记录与证据派生；成本与 Token 是基座估算，不是账单。')
  return `${lines.join('\n')}\n`
}
