import { createElement as h } from 'react'

export const buildStudioRequest = ({
  goal,
  name,
  repoPath,
  verify,
  acceptance,
  shadowReview,
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
  repoPath,
  ...(continueFrom === undefined || continueFrom === null ? {} : { continueFrom }),
  ...(constraints.trim() !== '' ? { projectConstraints: constraints } : {}),
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
export function StudioSetupFields({ constraintsView }) {
  return h('div', { className: 'crew-setup-extra' }, constraintsView)
}
