import { Fragment, createElement as h } from 'react'
import { DsGoalHeader } from '../../goal-island/ds-adapter.js'
import { buildGoalView } from '../../goal-island/model.js'
import { StudioActivityLine } from './activity-line.js'
import { studioActivityLine } from './status-line.js'
import { StudioPresence } from './presence.js'
import { StageDock } from './stage-dock.js'
import { SubroomTree } from './subroom-tree.js'
import { StudioTranscript } from './transcript.js'

// 工作室的房间视图：目标岛、状态行、时间线、阶段坞和交付卡。
export const studioView = {
  id: 'studio',
  buildViewModel: ({ room, seats }) => buildGoalView(room, seats),
  opensAtTop: ({ room }) => room.state === 'complete',
  header: ({ room, seats, actions }) => h(DsGoalHeader, {
    room,
    seats,
    onAdvance: () => {
      const index = room.stages.findIndex(stage => stage.state === 'active')
      if (index >= 0) actions.accept(index)
    },
  }),
  activity: ({ room, viewModel }) => h(StudioActivityLine, {
    text: studioActivityLine(room, viewModel),
    since: typeof room.busySince === 'number' ? room.busySince : null,
  }),
  transcript: ({ room, seats, state, actions }) => {
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
      seats,
      hideKinds: [],
      delivery: room.delivery ?? null,
      onAccept: actions.accept,
      onStageAccept: actions.accept,
      onApproval: actions.approval,
      onContinue: () => actions.startStudio({
        goal: `${room.goal}\n\n上一次交付「${room.name}」已经完成。现在在这个基础上继续：`,
        conclusion: '',
        sourceName: room.name,
        repoPath: room.repoPath ?? '',
      }),
    })
    // A finished room leads with the result; the sub-department tree follows
    // the folded work log. Live rooms keep the tree above the running work.
    return room.state === 'complete'
      ? h(Fragment, null, transcript, subrooms)
      : h(Fragment, null, subrooms, transcript)
  },
  presence: ({ room, seats }) => h(StudioPresence, { room, seats }),
  composerPlaceholder: () => '交代下一步，或问进度…',
  typing: () => null,
  dock: ({ room, dock }) => h(StageDock, { room, ...dock }),
}
