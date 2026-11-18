import { Fragment, createElement as h } from 'react'
import { GoalIslandHeader } from '../../goal-island/adapter.js'
import { StudioPresence } from './presence.js'
import { StatePanel } from '../../state-panel.js'
import { buildIdleDecision } from '../decision.js'
import { StudioTranscript } from './transcript.js'
import { returnToChatSeed } from './return-seed.js'
import { TypingLine } from '../typing-line.js'
import { StudioAdjust } from './rewind-dialog.js'
import { studioTyping } from './typing.js'

// 工作室的房间视图：一条聊天记录、一行状态、一个输入框；动作只在轮到你时出现。
export const studioView = {
  id: 'studio',
  opensAtTop: ({ room }) => room.state === 'complete',
  header: ({ room, actions }) => {
    const paused = room.state === 'paused' ? buildIdleDecision(room) : null
    return h(Fragment, null,
      h(GoalIslandHeader, { room, onOpenRoom: actions.selectRoom }),
      paused === null
        ? null
        : h(StatePanel, {
          key: `paused-${room.id}`,
          title: paused.title,
          body: paused.detail,
          tone: 'paused',
          action: h('button', {
            type: 'button',
            className: 'crew-link',
            onClick: () => actions.resume(),
          }, paused.primary?.label ?? '继续'),
        }))
  },
  tools: ({ room, actions }) => h(StudioAdjust, { key: `adjust-${room.id}`, room, onRewind: actions.rewind }),
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
    onResolveMerge: actions.resolveMerge,
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
  presence: ({ room, members, actions }) => h(StudioPresence, { room, members, onHold: actions.hold }),
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
