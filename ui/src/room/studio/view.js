import { Fragment, createElement as h } from 'react'
import { GoalIslandHeader } from '../../goal-island/adapter.js'
import { CrewStatusLine } from '../crew-status.js'
import { StudioPresence } from './presence.js'
import { StudioTranscript } from './transcript.js'
import { TypingLine } from '../typing-line.js'

// 工作室的房间视图：一条聊天记录、一行状态、一个输入框；动作只在轮到你时出现。
export const studioView = {
  id: 'studio',
  opensAtTop: ({ room }) => room.state === 'complete',
  header: ({ room, members, actions }) => h(GoalIslandHeader, {
    room,
    members,
    status: h(CrewStatusLine, { room, members, onSwap: actions.swapBody, onAdd: actions.addMember }),
    onOpenRoom: actions.selectRoom,
    onAdvance: () => {
      const index = room.stages.findIndex(stage => stage.state === 'active')
      if (index >= 0) actions.accept(index)
    },
  }),
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
    onAnswerCard: actions.answerCard,
    onCancelQueue: actions.cancelQueue,
    onSteerQueue: actions.steerQueue,
    onContinue: () => actions.startStudio({
      goal: `${room.goal}\n\n上一次结果「${room.name}」已经完成。现在在这个基础上继续：`,
      conclusion: '',
      sourceName: room.name,
      repoPath: room.repoPath ?? '',
    }),
    onReturn: () => {},
  }),
  presence: ({ room, members, actions }) => h(StudioPresence, { room, members, onHold: actions.hold }),
  composerPlaceholder: ({ room }) => room.state === 'complete' ? '已完成 · 说句话，再开一轮。' : '交代下一步，或问进度…',
  typing: ({ room, members }) => {
    if (room.state !== 'active') return null
    const busy = Array.isArray(room.busyMembers) ? room.busyMembers : []
    if (busy.length === 0) return null
    const names = busy
      .map(id => (members ?? []).find(member => member.id === id)?.name ?? id)
      .join('、')
    return h(TypingLine, { label: `${names} 正在输入` })
  },
}
