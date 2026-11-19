import { Fragment, createElement as h } from 'react'
import { GoalIslandHeader } from '../../goal-island/adapter.js'
import { PausedPanel } from '../paused-panel.js'
import { StudioTranscript } from './transcript.js'
import { returnToChatSeed } from './return-seed.js'
import { TypingLine } from '../typing-line.js'
import { StudioAdjust } from './rewind-dialog.js'
import { StopRoom } from '../stop-room.js'
import { studioTyping } from './typing.js'

// 工作室的房间视图：一条聊天记录、一行状态、一个输入框；动作只在轮到你时出现。
export const studioView = {
  id: 'studio',
  opensAtTop: ({ room }) => room.state === 'complete',
  header: ({ room, actions }) => h(Fragment, null,
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
    return h(Fragment, null,
      h(StopRoom, {
        key: `stop-${room.id}`,
        room,
        members,
        onStop: () => actions.stopRoom(),
      }),
      h(StudioAdjust, { key: `adjust-${room.id}`, room, onRewind: actions.rewind }))
  },
  activity: () => null,
  transcript: ({ room, members, actions }) => h(StudioTranscript, {
    key: `transcript-${room.id}`,
    room,
    members,
    hideKinds: [],
    delivery: room.delivery ?? null,
    onAccept: actions.accept,
    onStageAccept: actions.accept,
    onRework: actions.rework,
    onChoose: actions.chooseHuman,
    onReadArtifact: actions.readArtifact,
    onRoutine: enabled => actions.setRoutine(enabled),
    onResolveMerge: actions.resolveMerge,
    onApproval: actions.approval,
    onAllowBrowserRoom: actions.allowBrowserRoom,
    onAnswerCard: actions.answerCard,
    onCancelQueue: actions.cancelQueue,
    onSteerQueue: actions.steerQueue,
    onContinue: () => actions.startStudio({
      goal: `${room.goal}\n\n上一次结果「${room.name}」已经完成。现在在这个基础上继续：`,
      conclusion: '',
      sourceName: room.name,
      repoPath: room.repoPath ?? '',
    }),
    onDiscussChat: (() => {
      const seed = returnToChatSeed(room)
      return seed === null ? null : () => actions.startChat(seed)
    })(),
    onReturn: () => {},
  }),
  presence: () => null,
  composerPlaceholder: ({ room, members }) => {
    const done = (room.stages ?? []).length > 0 && room.stages.every(stage => stage.state === 'passed')
    if (room.state === 'complete' || done) return '已交付 · 还能和规划师聊聊。'
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
