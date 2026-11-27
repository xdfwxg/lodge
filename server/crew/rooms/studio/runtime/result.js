import { join } from 'node:path'
import { systemNotice } from '../../../notices.js'
import { verifierIds } from '../../../room-members.js'
import { workspaceOf } from './workspace.js'
import { runProof } from '../delivery/proof-runner.js'
import { addedFilesOf, allowedFilesFor, filesOutsidePackage, reservedFilesFor } from '../delivery/write-boundary.js'
import { reworkFloor } from '../../../../../shared/attempt.js'
import { PROOF_DIR, PROOF_FILE } from '../../../../../shared/proof.js'

// 执行官交回一步的结果：平台只负责把候选提交、diff 和文件清单固定下来，
// 再把结果交给验收员。怎么验证、验什么，由验收员按房间目标自己决定。
const changedSinceManifest = (before, current) => {
  const old = new Map((Array.isArray(before) ? before : []).map(item => [item.path, item.sha256]))
  const now = new Map((Array.isArray(current) ? current : []).map(item => [item.path, item.sha256]))
  const changed = []
  for (const [path, sha] of now) {
    if (old.get(path) !== sha) changed.push(path)
  }
  for (const path of old.keys()) {
    if (!now.has(path)) changed.push(path)
  }
  return [...new Set(changed)]
}

// 写边界的唯一入口：回合结束后把工作包之外的改动退回去，并留下一条房间消息。
// 单人和并行都用这一份——并行经理以前漏掉了这一步，两个执行官各自写出了整份交付。
export const enforceWriteBoundary = async ({ store, roomId, room, stage, stageIndex, memberId, repoPath, provider, filePort }) => {
  if (repoPath === null || repoPath === undefined || repoPath === '') return null
  const allowed = allowedFilesFor({ room, stage, memberId, root: repoPath })
  if (allowed === null) return null
  // 别的包认领的文件：辅助目录放行也不能碰，否则两个分支会在同一路径上撞车。
  const reserved = reservedFilesFor({ room, stage, memberId, root: repoPath })
  // 证明可能写在根目录，也可能按包写在 lodge-proof/<n>.json；两种都要读，
  // 否则并行阶段的辅助脚本会被当成包外改动退掉。
  const proofTexts = []
  try { proofTexts.push(String(filePort.read(join(repoPath, PROOF_FILE)))) } catch {}
  try {
    for (const name of filePort.list(join(repoPath, PROOF_DIR))) {
      if (!String(name).endsWith('.json')) continue
      try { proofTexts.push(String(filePort.read(join(repoPath, PROOF_DIR, name)))) } catch {}
    }
  } catch {}
  const proofText = proofTexts.join('\n')
  if (provider.capabilities().vcs === 'git' && typeof provider.revertPaths === 'function') {
    let dirty = { files: [], status: '' }
    try {
      dirty = await provider.changes({ path: repoPath })
    } catch {}
    const outside = filesOutsidePackage({
      files: dirty.files ?? [],
      allowed,
      added: addedFilesOf(dirty.status),
      proofText,
      reserved,
    })
    if (outside.length === 0) return null
    const reverted = provider.revertPaths({ path: repoPath, files: outside })
    const outOfBounds = {
      files: outside.slice(0, 50),
      reverted: Array.isArray(reverted.reverted) ? reverted.reverted.slice(0, 50) : [],
    }
    store.appendMessage(roomId, {
      kind: 'system',
      text: outOfBounds.reverted.length > 0
        ? `这一步改了这一步之外的文件，已退回：${outOfBounds.files.slice(0, 5).join('、')}。新加的辅助脚本要在证明里点名，或放在证明入口所在的目录。`
        : `这一步改了这一步之外的文件：${outOfBounds.files.slice(0, 5).join('、')}；没有退回，请验收时核对。`,
    })
    return outOfBounds
  }
  if (provider.capabilities().vcs !== 'git' && typeof provider.manifest === 'function' &&
    Array.isArray(room.stageBaseManifests?.[stageIndex])) {
    // 非 git 工作区没有可回退的版本：用阶段起点的文件清单算包外改动，交给门禁拦。
    let current = []
    try {
      current = provider.manifest({ path: repoPath })
    } catch {}
    const base = room.stageBaseManifests[stageIndex]
    const outside = filesOutsidePackage({
      files: changedSinceManifest(base, current),
      allowed,
      added: current.map(file => file.path).filter(path => !base.some(old => old.path === path)),
      proofText,
      reserved,
    })
    if (outside.length === 0) return null
    store.appendMessage(roomId, {
      kind: 'system',
      text: `这一步改了这一步之外的文件：${outside.slice(0, 5).join('、')}；这个工作区不能自动退回，验收前要处理。`,
    })
    return { files: outside.slice(0, 50), reverted: [] }
  }
  return null
}

export const createResultMarker = ({ store, roomId, review, markProgress, filePort }) => {
  const seen = new Set()

  // 结果必须从这个回合真正干活的成员副本里取，不能拿房间的集成目录顶替。
  const repoPathOf = (room, memberId) => {
    const memberPath = typeof memberId === 'string' ? room.worktrees?.[memberId] : null
    if (typeof memberPath === 'string' && memberPath !== '') return memberPath
    return typeof room.repoPath === 'string' && room.repoPath !== '' ? room.repoPath : null
  }

  const collect = async (room, repoPath, stageIndex, candidate, head, baseline) => {
    if (repoPath === null) return { files: [], diff: '', status: '' }
    const provider = workspaceOf(room)
    let files = []
    let diff = ''
    let status = ''
    try {
      const dirty = await provider.changes({ path: repoPath })
      files = dirty.files ?? []
      diff = dirty.diff ?? ''
      status = dirty.status ?? ''
    } catch {}
    if (files.length === 0 && baseline !== null && typeof provider.rangeChanges === 'function') {
      try {
        const range = await provider.rangeChanges({ path: repoPath, base: baseline })
        files = range.files ?? []
        diff = range.diff ?? ''
      } catch {}
    }
    if (files.length === 0 && typeof provider.filesInCommit === 'function') {
      const commit = candidate ?? (head !== baseline ? head : null)
      if (typeof commit === 'string' && commit !== '') files = provider.filesInCommit({ path: repoPath, commit }) ?? []
    }
    return { files, diff, status }
  }

  const markResultReady = async (room, stageIndex, turnId, worked, resultText = '', memberId = '') => {
    // 被写/读边界拦停的回合不算交付结果：平台没有接受它，也不能把它送去复核。
    if (room.blocked?.stage === stageIndex
      && (room.blocked.reason === 'boundary' || room.blocked.reason === 'read-boundary')) return
    const key = `${stageIndex}:${turnId}`
    if (seen.has(key)) return
    seen.add(key)
    const provider = workspaceOf(room)
    const repoPath = repoPathOf(room, memberId)
    const stage = room.stages?.[stageIndex] ?? null
    // 回合结束后先退回工作包之外的改动，再做候选提交：越界内容不能混进这次交付。
    const outOfBounds = await enforceWriteBoundary({ store, roomId, room, stage, stageIndex, memberId, repoPath, provider, filePort })
    let candidate = null
    try {
      if (repoPath !== null && provider.capabilities().candidate === true) {
        candidate = provider.submit({ path: repoPath, turnId, name: room.name })
        if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage: stageIndex, turnId, commit: candidate })
      }
    } catch (error) {
      systemNotice({ store, roomId, text: '这一步的结果没能固定下来；待处理。', error })
    }
    let head = null
    if (repoPath !== null && typeof provider.head === 'function') {
      try {
        head = provider.head({ path: repoPath })
      } catch (error) {
        // 工作副本被删/移走时，git 会直接抛；不能让它把 Lodge 进程带走。
        systemNotice({ store, roomId, text: '这一步的工作副本不见了；房间先停在这里，检查工作区后再继续。', error })
        return
      }
    }
    const acceptedRef = candidate ?? head
    const baseline = room.stageBases?.[stageIndex] ?? room.startHead ?? null
    const { files, diff, status } = await collect(room, repoPath, stageIndex, candidate, head, baseline)
    // 交付自带的证明由平台跑，不靠执行方或验收员复述；同时在阶段起点跑一次，
    // 行为要变的步骤如果在旧版本也绿，这条证明就没有绑定这次改动。
    // 证明只回答“能不能重跑”，不对账契约要求；要求覆盖由验收员的复核负责。
    const proofRun = await runProof({
      room: { ...room, repoPath },
      ref: acceptedRef,
      baseRef: baseline,
      behavior: stage?.behavior === 'preserve' ? 'preserve' : 'change',
    })

    // 同一 HEAD 上没有新结果时不重复送审；重做后的同一结果仍要重新送审。
    const messages = store.readMessages(roomId)
    const floor = reworkFloor(messages, stageIndex)
    const prior = [...messages].reverse().find(message => (
      message.kind === 'evidence' &&
      message.meta?.kind === 'result' &&
      (message.meta?.stage ?? 0) === stageIndex
    ))
    const afterRework = prior !== undefined && (prior.seq ?? 0) > floor
    const covered = afterRework ? (prior?.meta?.candidate ?? prior?.meta?.head ?? null) : null
    if (afterRework) {
      if (covered !== null && acceptedRef !== null && covered === acceptedRef) return
      if (!worked && covered === null) return
    }

    const parallel = room.orchestration === 'parallel' ||
      (Array.isArray(stage?.assignees) && stage.assignees.length > 1)
    const hasVerifier = verifierIds(room).length > 0
    store.appendMessage(roomId, {
      kind: 'evidence',
      authorId: 'system',
      text: hasVerifier ? '结果已经好了。' : '结果已经好了。',
      meta: {
        kind: 'result',
        stage: stageIndex,
        turnId,
        candidate,
        head: typeof acceptedRef === 'string' && acceptedRef !== '' ? acceptedRef : null,
        files,
        changedFiles: files,
        diff,
        status,
        proof: proofRun,
        ...(outOfBounds === null ? {} : { outOfBounds }),
        ...(typeof resultText === 'string' && resultText.trim() !== '' ? { resultText: resultText.slice(0, 4000) } : {}),
        repoPath,
        simulated: false,
        capturedAt: new Date().toISOString(),
      },
    })
    markProgress()
    // 并行时每个执行官只交自己那一份；等合并后的集成证据再统一复核，避免半成品先送审。
    if (!hasVerifier || parallel) return
    try {
      await review.request(stageIndex)
    } catch (error) {
      systemNotice({ store, roomId, text: '结果已经好了，但没能叫验收员来看；待处理。', error })
    }
  }

  return { markResultReady }
}
