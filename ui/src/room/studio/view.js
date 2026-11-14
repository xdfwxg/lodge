import { createElement as h } from 'react'
import { DsGoalHeader } from '../../goal-island/ds-adapter.js'
import { buildGoalView } from '../../goal-island/model.js'
import { StudioActivityLine } from './activity-line.js'
import { buildStudioDecision, showsDecisionCard, StudioDecisionCard, studioActivityLine } from './decision.js'
import { StudioPresence } from './presence.js'
import { StageDock } from './stage-dock.js'
import { StudioTranscript } from './transcript.js'
import { ReviewDialog } from './advanced.js'
import { ReplayDialog } from './replay.js'
import { ShadowDialog } from './shadow.js'

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
  transcript: ({ room, seats, decision, actions, store }) => h(StudioTranscript, {
    room,
    seats,
    hideKinds: [],
    delivery: room.delivery ?? null,
    onExportDelivery: () => void store.exportDelivery(),
    onAccept: actions.accept,
    onStageAccept: showsDecisionCard(decision) ? null : actions.accept,
    onApproval: actions.approval,
  }),
  presence: ({ room, seats }) => h(StudioPresence, { room, seats }),
  typing: () => null,
  // 阶段坞只在工作室出现；宿主只留一个容器。
  dock: ({ room, dock }) => h(StageDock, { room, ...dock }),
  overlay: ({ state, room, store }) => [
    state.reviewFor === room.id && state.review !== null
      ? h(ReviewDialog, { key: 'review', review: state.review, onClose: () => store.closeReview() })
      : null,
    state.replayFor === room.id && state.replay !== null
      ? h(ReplayDialog, { key: 'replay', replay: state.replay, onClose: () => store.closeReplay() })
      : null,
    state.shadowFor === room.id && state.shadow !== null
      ? h(ShadowDialog, {
        key: 'shadow',
        review: state.shadow,
        focus: state.shadowFocus,
        onClose: () => store.closeShadow(),
      })
      : null,
  ],
}
