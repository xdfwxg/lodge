import { systemNotice } from '../../../notices.js'
import { verifierIds } from '../../../room-members.js'
import { workspaceOf } from '../workspace.js'
import { reworkFloor } from '../../../../../shared/attempt.js'

// 执行官交回一步的结果：平台只负责把候选提交、diff 和文件清单固定下来，
// 再把结果交给验收员。怎么验证、验什么，由验收员按房间目标自己决定。
export const createResultMarker = ({ store, roomId, review, markProgress }) => {
  const seen = new Set()

  const repoPathOf = room => (
    typeof room.repoPath === 'string' && room.repoPath !== '' ? room.repoPath : null
  )

  const collect = async (room, stageIndex, candidate, head, baseline) => {
    const repoPath = repoPathOf(room)
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

  const markResultReady = async (room, stageIndex, turnId, worked, resultText = '') => {
    const key = `${stageIndex}:${turnId}`
    if (seen.has(key)) return
    seen.add(key)
    const provider = workspaceOf(room)
    const repoPath = repoPathOf(room)
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
    const { files, diff, status } = await collect(room, stageIndex, candidate, head, baseline)

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
        ...(typeof resultText === 'string' && resultText.trim() !== '' ? { resultText: resultText.slice(0, 4000) } : {}),
        repoPath: room.repoPath,
        simulated: false,
        capturedAt: new Date().toISOString(),
      },
    })
    markProgress()
    if (!hasVerifier) return
    try {
      await review.request(stageIndex)
    } catch (error) {
      systemNotice({ store, roomId, text: '结果已经好了，但没能叫验收员来看；待处理。', error })
    }
  }

  return { markResultReady }
}
