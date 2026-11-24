import { createElement as h, useEffect, useState } from 'react'
import { dateTimeOf } from '../view-format.js'
import { StatePanel } from '../state-panel.js'
import { StudioTranscript } from '../room/studio/transcript.js'
import { roundStatusOf } from './round-list.js'

export function RoundView({ room, roundId, store, onBack }) {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setData(null)
    setFailed(false)
    void Promise.resolve(store.loadRound(room.id, roundId)).then(result => {
      if (!live) return
      if (result?.round?.id === undefined || result.round.id === null || result.room?.id === undefined) {
        setFailed(true)
        return
      }
      setData(result)
    })
    return () => { live = false }
  }, [room.id, roundId, store])

  if (failed) {
    return h('main', { className: 'dsb-main crew-round-history' },
      h('div', { className: 'crew-round-history-inner' },
        h(StatePanel, {
          title: '这一轮没有打开',
          body: '它可能已经不在了。回到工作室看看现在这一轮。',
          tone: 'error',
          action: h('button', { type: 'button', className: 'crew-link', onClick: onBack }, '回到工作室'),
        })))
  }

  if (data === null) {
    return h('main', { className: 'dsb-main crew-round-history' },
      h('div', { className: 'crew-round-history-inner' },
        h(StatePanel, { title: '正在打开这一轮…' })))
  }

  const round = data.round
  const messages = Array.isArray(data.messages) ? data.messages : []
  const historyRoom = { ...data.room, messages }
  const ordinal = Number.isInteger(round.ordinal) ? `第 ${round.ordinal} 轮` : '这一轮'

  return h('main', { className: 'dsb-main crew-round-history' },
    h('div', { className: 'crew-round-history-inner' },
      h('button', { type: 'button', className: 'crew-link crew-round-history-back', onClick: onBack }, '← 回到工作室'),
      h('p', { className: 'crew-round-history-kicker' }, `${ordinal} · ${roundStatusOf(round)}`),
      h('h1', { className: 'crew-round-history-title' }, round.name || round.goal || '未命名的一轮'),
      typeof round.goal === 'string' && round.goal.trim() !== '' && round.goal !== round.name
        ? h('p', { className: 'crew-round-history-goal' }, round.goal)
        : null,
      h('p', { className: 'crew-round-history-meta' },
        round.completedAt ? `交付于 ${dateTimeOf(round.completedAt)}` : '这一轮已经结束',
        round.completedCommit ? ` · 版本 ${String(round.completedCommit).slice(0, 8)}` : ''),
      h('p', { className: 'crew-round-history-note' }, '旧轮只能查看；要接着做，回到工作室开新一轮。'),
      h('div', { className: 'crew-round-history-transcript' },
        h(StudioTranscript, {
          room: historyRoom,
          members: room.members ?? [],
          delivery: historyRoom.delivery ?? null,
          onAccept: null,
          onStageAccept: null,
          onRework: null,
          onChoose: null,
          onReadArtifact: null,
          onResolveMerge: null,
          onApproval: null,
          onAnswerCard: null,
          onCancelQueue: null,
          onSteerQueue: null,
          onDiscussChat: null,
          onReturn: null,
        }))))
}
