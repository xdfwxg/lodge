import { independenceLabel } from '../../digest.js'
import { memberLabelMap } from '../../member-labels.js'
import { artifactKindOf } from '../../../../shared/artifact.js'
import { deliveryKindOf } from '../../../../shared/delivery.js'
import { judgmentOf, verdictPassed } from '../../../../shared/judgment.js'

const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value !== ''))]

const artifactList = (messages, roots = [], { withContent = false } = {}) => {
  const normalizedRoots = roots.filter(root => typeof root === 'string' && root !== '').map(root => root.replace(/\/$/, ''))
  const byPath = new Map()
  const absolute = (message, path) => {
    if (typeof path !== 'string' || path === '') return null
    if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path
    if (typeof message.meta?.repoPath === 'string' && message.meta.repoPath !== '') {
      return `${message.meta.repoPath.replace(/\/$/, '')}/${path}`
    }
    return normalizedRoots.length === 0 ? path : null
  }
  for (const message of messages) {
    const listed = [
      ...(message.meta?.artifacts ?? []),
      ...(message.meta?.files ?? []).map(file => ({ path: file })),
      ...(message.meta?.changedFiles ?? []).map(file => ({ path: file })),
    ]
    for (const artifact of listed) {
      const path = absolute(message, artifact?.path)
      if (path === null) continue
      if (normalizedRoots.length > 0 && !normalizedRoots.some(root => path === root || path.startsWith(`${root}/`))) continue
      const root = normalizedRoots
        .filter(item => path === item || path.startsWith(`${item}/`))
        .sort((a, b) => b.length - a.length)[0]
      byPath.set(path, {
        path,
        relativePath: root === undefined || path === root ? path : path.slice(root.length + 1),
        kind: artifactKindOf(path),
        bytes: Number.isFinite(artifact.bytes) ? artifact.bytes : null,
        ...(withContent && typeof artifact.content === 'string' ? { content: artifact.content } : {}),
      })
    }
  }
  return [...byPath.values()]
}

// 平台截下的渲染图也是交付的一部分：让人一眼看到做出来的样子。
const previewArtifacts = room => {
  const roots = [room.repoPath, ...Object.values(room.worktrees ?? {})]
    .filter(root => typeof root === 'string' && root !== '')
    .map(root => root.replace(/\/$/, ''))
  return (Array.isArray(room.previews) ? room.previews : []).flatMap(preview => {
    const path = typeof preview?.local === 'string' ? preview.local : ''
    if (path === '') return []
    const root = roots
      .filter(item => path === item || path.startsWith(`${item}/`))
      .sort((a, b) => b.length - a.length)[0]
    if (roots.length > 0 && root === undefined) return []
    return [{
      path,
      relativePath: root === undefined || path === root ? path : path.slice(root.length + 1),
      kind: 'image',
      role: 'render',
      bytes: Number.isFinite(preview.bytes) ? preview.bytes : null,
    }]
  })
}

// 完成态交付卡只读投影：目标、阶段、命令、改动文件、结论与 commit。
export const buildDelivery = (room, messages = []) => {
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
        changedFiles: Array.isArray(message.meta?.changedFiles) ? message.meta.changedFiles : [],
        simulated: message.meta?.simulated === true,
      }))
    const verdicts = stageMessages
      .filter(message => message.kind === 'verdict')
      .map(message => ({
        id: message.id,
        authorId: message.authorId ?? 'verifier',
        pass: verdictPassed(message),
        text: judgmentOf(message)?.reason || message.text || '',
        evidenceId: message.meta?.evidenceId ?? null,
      }))
    const manual = [...stageMessages].reverse()
      .find(message => message.kind === 'evidence' && message.meta?.kind === 'manual')
    const manualFiles = Array.isArray(manual?.meta?.changedFiles)
      ? manual.meta.changedFiles
      : Array.isArray(manual?.meta?.files) ? manual.meta.files : []
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
        changedFiles: manualFiles,
      },
      verdicts,
      changedFiles: unique([...commands.flatMap(command => command.changedFiles), ...manualFiles]),
    }
  })
  const commands = stages.flatMap(stage => stage.commands)
  const changedFiles = unique(stages.flatMap(stage => stage.changedFiles))
  const visualMissing = messages.some(message => message.kind === 'verdict' && message.meta?.visualMissing === true)
  // 渲染图需要一双能看的眼睛；声明和实际看到分开记，不把声明当成已验证。
  const previews = Array.isArray(room.previews) ? room.previews : []
  const verifiers = (room.members ?? []).filter(member => (
    (member.roleKind ?? member.role) === 'verifier'
  ))
  const lastVisual = [...messages].reverse()
    .map(message => message.kind === 'verdict' ? message.meta?.judgment?.visual : null)
    .find(value => value !== null && value !== undefined) ?? null
  const vision = previews.length === 0
    ? null
    : {
      needed: true,
      declared: verifiers.some(member => member.body?.capabilities?.images === true),
      checked: lastVisual !== null,
      seen: typeof lastVisual?.seen === 'boolean' ? lastVisual.seen : null,
      numbers: lastVisual === null ? null : { colors: lastVisual.colors ?? null, contrast: lastVisual.contrast ?? null },
      missing: visualMissing,
    }
  const lastAt = messages.reduce((latest, message) => Math.max(latest, message.ts ?? 0), 0)
  const completedAt = room.completedAt ?? (lastAt > 0 ? lastAt : null)
  // 常驻承诺每周都会产出一次；标题应该是这一期，不是把同一句目标再抄一遍。
  const periodOf = ts => {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return ''
    const date = new Date(ts)
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  const periodName = periodOf(completedAt) === '' ? '本期' : `本期 · ${periodOf(completedAt)}`
  const delivery = {
    roomId: room.id,
    name: room.demo === true
      ? String(room.name ?? '').replace(/^示例[：:]\s*/, '')
      : room.promise === undefined || room.promise === null
        ? (String(room.goal ?? '').trim() || room.name)
        : periodName,
    goal: room.goal,
    sample: room.demo === true,
    completedAt,
    commit: typeof room.completedCommit === 'string' && room.completedCommit !== '' ? room.completedCommit : null,
    independenceLabel: independenceLabel(room),
    archived: Boolean(room.archivedAt),
    usage: room.usage ?? null,
    memberNames: memberLabelMap(room),
    workspace: {
      provider: room.workspace?.provider ?? 'git',
      vcs: room.workspace?.capabilities?.vcs ?? 'none',
    },
    workspacePath: room.repoPath ?? Object.values(room.worktrees ?? {})[0] ?? null,
    sourcePath: room.sourceRepo ?? null,
    artifacts: [
      ...artifactList(
        messages,
        [room.repoPath, ...Object.values(room.worktrees ?? {})],
        { withContent: room.demo === true },
      ),
      ...previewArtifacts(room),
    ],
    stages,
    commands,
    changedFiles,
    visualMissing,
    vision,
    openQuestions: typeof room.openQuestion === 'string' && room.openQuestion.trim() !== ''
      ? [room.openQuestion.trim()]
      : [],
    evidenceCount: stages.reduce((total, stage) => total + stage.commands.length + (stage.manual === null ? 0 : 1), 0),
  }
  delivery.kind = deliveryKindOf(delivery)
  return delivery
}
