import { createElement as h } from 'react'

export const buildStudioRequest = ({
  goal,
  name,
  repoPath,
  verify,
  acceptance,
  shadowReview,
  requireIndependent,
  includeConstraints,
  constraints,
  proposal,
  answers,
  seatChoices,
  hasSeatChoice,
  selectedModelOf,
  continueFrom,
}) => ({
  name,
  roomType: 'studio',
  verify,
  acceptance,
  ...(shadowReview ? { shadowReview: true } : {}),
  ...(requireIndependent ? { independencePolicy: 'require' } : {}),
  repoPath,
  ...(continueFrom === undefined || continueFrom === null ? {} : { continueFrom }),
  ...(includeConstraints && constraints.trim() !== '' ? { projectConstraints: constraints } : {}),
  ...(hasSeatChoice
    ? {
      seats: proposal.seats.map((seat, index) => {
        const choice = seatChoices[index] ?? { engine: '', model: '' }
        const model = choice.model !== '' ? choice.model : selectedModelOf(choice)
        return {
          role: seat.role,
          name: seat.name,
          ...(choice.engine === '' ? {} : { engine: choice.engine }),
          ...(choice.engine === '' || model === '' ? {} : { model }),
        }
      }),
    }
    : {}),
  plan: {
    done: proposal.done,
    ...(typeof proposal.orchestration === 'string' ? { orchestration: proposal.orchestration } : {}),
    ...(typeof proposal.why === 'string' && proposal.why !== '' ? { why: proposal.why } : {}),
    ...(Array.isArray(proposal.stages) && proposal.stages.length > 0 ? { stages: proposal.stages } : {}),
    answers: (proposal.questions ?? []).map((question, index) => ({
      question: question.text,
      answer: answers[index] ?? question.recommendation,
    })),
  },
})

// 工作室建房字段：影子评审、跨厂商要求和项目约束；聊天室不出现这些。
export function StudioSetupFields({
  shadowReview,
  onShadowReview,
  requireIndependent,
  onRequireIndependent,
  constraintsView,
}) {
  return h('div', null,
    h('label', { className: 'crew-check' },
      h('input', {
        type: 'checkbox',
        checked: shadowReview,
        onChange: event => onShadowReview(event.target.checked),
      }),
      '影子评审：评估建议只记录，不注入验收员'),
    h('label', { className: 'crew-check' },
      h('input', {
        type: 'checkbox',
        checked: requireIndependent,
        onChange: event => onRequireIndependent(event.target.checked),
      }),
      '严格要求跨厂商复核：没有第二厂商时拒绝建房'),
    constraintsView)
}
