import { Fragment, createElement as h } from 'react'
import { GoalIslandHeader } from '../../goal-island/adapter.js'
import { roomStatusOf, roundStatusOf } from '../../../../shared/room-status.js'
import { ROUND_STATUS } from '../../../../shared/states.js'
import { PausedPanel } from '../paused-panel.js'
import { StudioTranscript } from './transcript.js'
import { returnToChatSeed } from '../../room-seeds.js'
import { TypingLine } from '../typing-line.js'
import { PromiseCard } from '../promise-card.js'
import { DEFAULT_PROMISE_SCHEDULE } from '../../../../shared/promise.js'
import { stripAttachmentTags } from '../../../../shared/attachments.js'
import { studioTyping } from './typing.js'

// 工作室的房间视图：一条聊天记录、一行状态、一个输入框；动作只在轮到你时出现。
export const studioView = {
  id: 'studio',
  className: 'crew-room-studio',
  header: ({ room, actions }) => {
    const nav = [
      room.sourceRoomId && room.sourceName
        ? h('button', {
          key: 'source',
          type: 'button',
          className: 'crew-link',
          onClick: () => actions.selectRoom(room.sourceRoomId),
        }, `← ${room.sourceName}`)
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
          // 连不上模型服务时，按钮就是“重试”：立刻再连一次，不等下一轮自动重连。
          if (signal?.needs === 'connection' && typeof actions.resume === 'function') {
            actions.resume()
            return true
          }
          if (signal?.needs === 'blocked' && Number.isInteger(signal.stage)) {
            actions.retry(signal.stage, '')
            return true
          }
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
      }),
      h(PromiseCard, {
        room,
        onRun: () => actions.runPromise(),
        onPause: () => actions.updatePromise({ status: 'paused' }),
        onResume: () => actions.updatePromise({ status: 'active' }),
        onStop: () => actions.updatePromise({ status: 'stopped' }),
        onUpdate: input => actions.updatePromise(input),
      }))
  },
  activity: () => null,
  transcript: ({ room, members, actions }) => {
    return h(Fragment, null,
      h(StudioTranscript, {
        key: `transcript-${room.id}`,
        room,
      members,
      hideKinds: [],
      delivery: room.delivery ?? null,
      onDecision: actions.answerDecision,
      onRework: actions.rework,
      onChoose: actions.chooseHuman,
      onReadArtifact: actions.readArtifact,
      onResolveMerge: actions.resolveMerge,
      onApproval: actions.approval,
      onForgetMemory: actions.forgetMemory,
      onAnswerCard: actions.answerCard,
      onCancelQueue: actions.cancelQueue,
      onSteerQueue: actions.steerQueue,
      onKeepPromise: room.demo !== true && (room.promise === undefined || room.promise === null)
        ? () => actions.keepPromise({
          text: stripAttachmentTags(room.goal ?? room.workRound?.goal ?? '').trim(),
          schedule: DEFAULT_PROMISE_SCHEDULE,
        })
        : null,
      onDiscussChat: (() => {
        const seed = returnToChatSeed(room)
        return seed === null ? null : () => actions.startChat(seed)
      })(),
      onReturn: () => {},
      }),
    )
  },
  presence: () => null,
  // 只有交付过的一轮，输入框才是下一轮的目标；停下的一轮，下一句是接着这一轮说。
  canStartRound: ({ room }) => roomStatusOf(room) === 'idle' && roundStatusOf(room) === ROUND_STATUS.completed,
  composerPlaceholder: ({ room, members }) => {
    if (roundStatusOf(room) === ROUND_STATUS.stopped) return '接着这一轮说点什么…'
    if (roomStatusOf(room) === 'idle') return '说说下一轮要做什么…'
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
