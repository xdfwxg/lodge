import { Fragment, createElement as h } from 'react'
import { GoalIslandHeader } from '../../goal-island/adapter.js'
import { PausedPanel } from '../paused-panel.js'
import { StudioTranscript } from './transcript.js'
import { returnToChatSeed } from './return-seed.js'
import { TypingLine } from '../typing-line.js'
import { studioTyping } from './typing.js'

// 工作室的房间视图：一条聊天记录、一行状态、一个输入框；动作只在轮到你时出现。
export const studioView = {
  id: 'studio',
  className: 'crew-room-studio',
  opensAtTop: ({ room }) => room.state === 'complete',
  header: ({ room, actions }) => {
    const projectId = room.workRound?.projectId ?? room.defaultProjectId
    const rounds = room.rounds ?? []
    const hasHistory = rounds.length > 0 || Boolean(projectId)
    const nav = [
      room.sourceRoomId && room.sourceName
        ? h('button', {
          key: 'source',
          type: 'button',
          className: 'crew-link',
          onClick: () => actions.selectRoom(room.sourceRoomId),
        }, `← ${room.sourceName}`)
        : null,
      hasHistory && typeof actions.openRounds === 'function'
        ? h('button', {
          key: 'history',
          type: 'button',
          className: 'crew-link',
          onClick: () => actions.openRounds(),
        }, '历史')
        : null,
    ].filter(Boolean)
    return h(Fragment, null,
      h('div', { className: 'studio-topbar' },
        h('div', { className: 'studio-topbar-nav' },
          nav.flatMap((node, index) => (index === 0
            ? [node]
            : [h('span', { key: `dot-${index}`, className: 'studio-topbar-dot', 'aria-hidden': 'true' }, '·'), node])))),
      h(GoalIslandHeader, {
        room,
        onOpenRoom: actions.selectRoom,
        onSignalAction: (signal, action) => {
          if (signal?.needs !== 'review-timeout' || !Number.isInteger(signal.stage)) return false
          if (action === 'rework') actions.rework(signal.stage, '')
          else actions.verify(signal.stage)
          return true
        },
      }),
      h(PausedPanel, {
        room,
        onResume: () => actions.resume(),
        onFixMember: memberId => actions.swapBody(memberId),
      }))
  },
  activity: () => null,
  transcript: ({ room, members, actions }) => {
    const roomsById = new Map((actions.rooms ?? []).map(item => [item.id, item]))
    const runs = (room.routine?.runIds ?? []).map(id => roomsById.get(id)).filter(Boolean)
    const lastRun = roomsById.get(room.routine?.lastRoomId) ?? runs[runs.length - 1] ?? null
    const latestRun = lastRun?.delivery !== null && lastRun?.delivery !== undefined
      ? lastRun
      : [...runs].reverse().find(run => run.delivery !== null && run.delivery !== undefined) ?? lastRun
    return h(Fragment, null,
      h(StudioTranscript, {
        key: `transcript-${room.id}`,
        room,
      members,
      hideKinds: [],
      delivery: room.delivery ?? null,
      latestRun,
      runs,
      onAccept: actions.accept,
      onStageAccept: actions.accept,
      onRework: actions.rework,
      onChoose: actions.chooseHuman,
      onReadArtifact: actions.readArtifact,
      onRoutine: null,
      onOpenRun: id => actions.selectRoom(id),
      onResolveMerge: actions.resolveMerge,
      onApproval: actions.approval,
      onAnswerCard: actions.answerCard,
      onCancelQueue: actions.cancelQueue,
      onSteerQueue: actions.steerQueue,
      onDiscussChat: (() => {
        const seed = returnToChatSeed(room)
        return seed === null ? null : () => actions.startChat(seed)
      })(),
      onReturn: () => {},
      }),
    )
  },
  presence: () => null,
  canStartRound: ({ room }) => (
    (room.state === 'idle' || room.state === 'complete' || room.workRound?.status === 'completed') &&
    (room.stages ?? []).length > 0 &&
    room.stages.every(stage => stage.state === 'passed')
  ),
  composerPlaceholder: ({ room, members }) => {
    const done = (room.stages ?? []).length > 0 && room.stages.every(stage => stage.state === 'passed')
    if (room.state === 'idle' || room.state === 'complete' || done) return '说说下一轮要做什么…'
    const active = (room.stages ?? []).findIndex(stage => stage.state === 'active')
    if (room.lastPlannerDecision?.kind === 'human' && room.lastPlannerDecision?.stage === active) {
      return '把缺的信息发给这一步…'
    }
    const lead = (members ?? []).find(member => member.role === 'lead' || member.roleKind === 'planner')
    return `对${lead?.name ?? '规划师'}说…`
  },
  typing: ({ room, members }) => {
    const line = studioTyping(room, members ?? [])
    return line === null ? null : h(TypingLine, line)
  },
}
