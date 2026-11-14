import { createElement as h } from 'react'
import { DsGoalHeader } from '../../goal-island/ds-adapter.js'
import { buildGoalView } from '../../goal-island/model.js'
import { StudioActivityLine } from './activity-line.js'
import { buildStudioDecision, showsDecisionCard, StudioDecisionCard, studioActivityLine } from './decision.js'
import { StudioPresence } from './presence.js'
import { StudioTranscript } from './transcript.js'

// 工作室的房间视图：目标岛、决策卡、步骤时间线、在场都在这里，聊天室不感知。
export const studioView = {
  id: 'studio',
  buildViewModel: ({ room, seats }) => buildGoalView(room, seats),
  buildDecision: ({ room, viewModel }) => buildStudioDecision(room, viewModel),
  header: ({ room, seats, store, actions }) => h(DsGoalHeader, {
    room,
    seats,
    store,
    actions: {
      audit: actions.audit,
      review: actions.review,
      continue: actions.continueRoom,
    },
  }),
  activity: ({ room, viewModel, decision }) => (
    showsDecisionCard(decision)
      ? null
      : h(StudioActivityLine, {
        text: studioActivityLine(room, viewModel),
        since: typeof room.busySince === 'number' ? room.busySince : null,
      })
  ),
  decisionCard: ({ decision, actions }) => h(StudioDecisionCard, { decision, onAction: actions.decision }),
  transcript: ({ room, seats, decision, actions }) => h(StudioTranscript, {
    room,
    seats,
    hideKinds: [],
    onAccept: actions.accept,
    onStageAccept: showsDecisionCard(decision) ? null : actions.accept,
    onApproval: actions.approval,
    onStartStudio: actions.startStudio,
  }),
  presence: ({ room, seats }) => h(StudioPresence, { room, seats }),
  typing: () => null,
}
