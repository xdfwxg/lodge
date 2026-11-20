import { Fragment, createElement as h } from 'react'
import { GoalIslandHeader } from '../../goal-island/adapter.js'
import { PausedPanel } from '../paused-panel.js'
import { RoomReview } from '../room-review.js'
import { StudioTranscript } from './transcript.js'
import { returnToChatSeed } from './return-seed.js'
import { TypingLine } from '../typing-line.js'
import { StudioAdjust } from './rewind-dialog.js'
import { studioTyping } from './typing.js'

// 工作室的房间视图：一条聊天记录、一行状态、一个输入框；动作只在轮到你时出现。
export const studioView = {
  id: 'studio',
  className: 'crew-room-studio',
  opensAtTop: ({ room }) => room.state === 'complete',
  header: ({ room, actions }) => h(Fragment, null,
    room.routineGoalId ? h('div', { className: 'studio-run-back' },
      h('button', {
        type: 'button',
        className: 'crew-link',
        onClick: () => actions.selectRoom(room.routineGoalId),
      }, '← 回到目标')) : null,
    room.sourceRoomId && room.sourceName
      ? h('div', { className: 'studio-run-back' },
        h('button', {
          type: 'button',
          className: 'crew-link',
          onClick: () => actions.selectRoom(room.sourceRoomId),
        }, `← 上一版《${room.sourceName}》`))
      : null,
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
    })),
  tools: ({ room, members, actions }) => {
    if (room.state !== 'active' || room.live !== true) return null
    const stages = (room.stages ?? []).filter(stage => stage.state !== 'pending')
    if (stages.length === 0) return null
    return h(StudioAdjust, { key: `adjust-${room.id}`, room, onRewind: actions.rewind })
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
      onRoutine: patch => actions.setRoutine(patch),
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
      h(RoomReview, {
        key: `review-${room.id}`,
        room,
        finished: room.state === 'complete',
      }),
    )
  },
  presence: () => null,
  canFollowup: ({ room }) => (
    room.state === 'complete' &&
    (room.stages ?? []).length > 0 &&
    room.stages.every(stage => stage.state === 'passed')
  ),
  composerPlaceholder: ({ room, members }) => {
    const done = (room.stages ?? []).length > 0 && room.stages.every(stage => stage.state === 'passed')
    if (room.state === 'complete' || done) return '问规划师；要改就写一句，点「接着改」'
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
