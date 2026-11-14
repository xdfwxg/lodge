import { createElement as h } from 'react'
import { DsGoalHeader } from '../../goal-island/ds-adapter.js'
import { buildGoalView } from '../../goal-island/model.js'
import { StudioActivityLine } from './activity-line.js'
import { studioActivityLine } from './status-line.js'
import { StudioPresence } from './presence.js'
import { StageDock } from './stage-dock.js'
import { StudioTranscript } from './transcript.js'

// 工作室的房间视图：目标岛、状态行、时间线、阶段坞和交付卡。
export const studioView = {
  id: 'studio',
  buildViewModel: ({ room, seats }) => buildGoalView(room, seats),
  header: ({ room, seats }) => h(DsGoalHeader, { room, seats }),
  activity: ({ room, viewModel }) => h(StudioActivityLine, {
    text: studioActivityLine(room, viewModel),
    since: typeof room.busySince === 'number' ? room.busySince : null,
  }),
  transcript: ({ room, seats, actions }) => h(StudioTranscript, {
    room,
    seats,
    hideKinds: [],
    delivery: room.delivery ?? null,
    onAccept: actions.accept,
    onStageAccept: actions.accept,
    onApproval: actions.approval,
  }),
  presence: ({ room, seats }) => h(StudioPresence, { room, seats }),
  typing: () => null,
  dock: ({ room, dock }) => h(StageDock, { room, ...dock }),
}
