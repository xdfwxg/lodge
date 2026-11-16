import { Fragment, createElement as h } from 'react'
import { DsGoalHeader } from '../../goal-island/ds-adapter.js'
import { buildGoalView } from '../../goal-island/model.js'
import { CrewStatusLine } from './crew-status.js'
import { StudioPresence } from './presence.js'
import { HandoffIntake } from './intake.js'
import { returnToChatSeed } from './return-seed.js'
import { StageDock } from './stage-dock.js'
import { SubroomTree } from './subroom-tree.js'
import { StudioTranscript } from './transcript.js'

// 工作室的房间视图：目标岛、状态行、时间线、阶段坞和结果卡。
export const studioView = {
  id: 'studio',
  buildViewModel: ({ room, members }) => buildGoalView(room, members),
  opensAtTop: ({ room }) => room.state === 'complete',
  header: ({ room, members, actions }) => h(DsGoalHeader, {
    room,
    members,
    status: h(CrewStatusLine, { room, members }),
    onAdvance: () => {
      const index = room.stages.findIndex(stage => stage.state === 'active')
      if (index >= 0) actions.accept(index)
    },
  }),
  activity: () => null,
  transcript: ({ room, members, state, actions }) => {
    const subrooms = h(SubroomTree, {
      key: `subrooms-${room.id}`,
      room,
      rooms: state.rooms,
      onSelect: actions.selectRoom,
      onCreate: actions.createSubroom,
    })
    const transcript = h(StudioTranscript, {
      key: `transcript-${room.id}`,
      room,
      members,
      hideKinds: [],
      delivery: room.delivery ?? null,
      onAccept: actions.accept,
      onStageAccept: actions.accept,
      advisor: state.advisor ?? { available: false, host: '' },
      onShadowReconfirm: () => actions.shadowReview(true),
      onAnswerCard: actions.answerCard,
      onCancelQueue: actions.cancelQueue,
      onSteerQueue: actions.steerQueue,
      onContinue: () => actions.startStudio({
        goal: `${room.goal}\n\n上一次结果「${room.name}」已经完成。现在在这个基础上继续：`,
        conclusion: '',
        sourceName: room.name,
        repoPath: room.repoPath ?? '',
      }),
      onReturn: () => {
        const seed = returnToChatSeed(room)
        if (seed !== null) actions.startChat(seed)
      },
    })
    // The work leads; sub-departments follow it, so an empty tree never sits
    // above the first thing the room has to say.
    return h(Fragment, null,
      h(HandoffIntake, { key: `intake-${room.id}`, handoff: room.handoff }),
      transcript,
      subrooms)
  },
  presence: ({ room, members, actions }) => h(StudioPresence, { room, members, onHold: actions.hold }),
  composerPlaceholder: () => '交代下一步，或问进度…',
  typing: () => null,
  dock: ({ room, dock }) => h(StageDock, { room, ...dock }),
}
