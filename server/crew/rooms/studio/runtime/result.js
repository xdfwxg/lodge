import { systemNotice } from '../../../notices.js'
import { verifierIds } from '../../../room-members.js'
import { workspaceOf } from '../workspace.js'
import { runProof } from '../proof-runner.js'
import { allowedFilesFor, filesOutsidePackage } from '../write-boundary.js'
import { reworkFloor } from '../../../../../shared/attempt.js'

// 执行官交回一步的结果：平台只负责把候选提交、diff 和文件清单固定下来，
// 再把结果交给验收员。怎么验证、验什么，由验收员按房间目标自己决定。
export const createResultMarker = ({ store, roomId, review, markProgress }) => {
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
    const key = `${stageIndex}:${turnId}`
    if (seen.has(key)) return
    seen.add(key)
    const provider = workspaceOf(room)
    const repoPath = repoPathOf(room, memberId)
    const stage = room.stages?.[stageIndex] ?? null
    // 回合结束后先退回工作包之外的改动，再做候选提交：越界内容不能混进这次交付。
    // 只有 git 工作副本能可靠区分“这次改了什么”；复制目录和原地目录没有这层证据，靠验收核对。
    let outOfBounds = null
    const allowed = repoPath === null ? null : allowedFilesFor({ room, stage, memberId, root: repoPath })
    if (repoPath !== null && allowed !== null &&
      provider.capabilities().vcs === 'git' && typeof provider.revertPaths === 'function') {
      let dirty = { files: [] }
      try {
        dirty = await provider.changes({ path: repoPath })
      } catch {}
      const outside = filesOutsidePackage({ files: dirty.files ?? [], allowed })
      if (outside.length > 0) {
        const reverted = provider.revertPaths({ path: repoPath, files: outside })
        outOfBounds = {
          files: outside.slice(0, 50),
          reverted: Array.isArray(reverted.reverted) ? reverted.reverted.slice(0, 50) : [],
        }
        const names = outOfBounds.files.slice(0, 5).join('、')
        store.appendMessage(roomId, {
          kind: 'system',
          text: outOfBounds.reverted.length > 0
            ? `这一步改了这一步之外的文件，已退回：${names}。`
            : `这一步改了这一步之外的文件：${names}；没有退回，请验收时核对。`,
        })
      }
    }
    let candidate = null
    try {
      if (repoPath !== null && provider.capabilities().candidate === true) {
        candidate = provider.submit({ path: repoPath, turnId, name: room.name })
        if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage: stageIndex, turnId, commit: candidate })
      }
    } catch (error) {
      systemNotice({ store, roomId, text: '这一步的结果没能固定下来；待处理。', error })
    }
    const head = repoPath !== null && typeof provider.head === 'function'
      ? provider.head({ path: repoPath })
      : null
    const acceptedRef = candidate ?? head
    const baseline = room.stageBases?.[stageIndex] ?? room.startHead ?? null
    const { files, diff, status } = await collect(room, repoPath, stageIndex, candidate, head, baseline)
    // 交付自带的证明由平台跑，不靠执行方或验收员复述；同时在阶段起点跑一次，
    // 行为要变的步骤如果在旧版本也绿，这条证明就没有绑定这次改动。
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
