import { createElement as h } from 'react'

export const buildStudioRequest = ({
  goal,
  name,
  repoPath,
  verify,
  acceptance,
  proposal,
  answers,
  seatChoices,
  hasSeatChoice,
  selectedModelOf,
}) => ({
  name,
  roomType: 'studio',
  verify,
  acceptance,
  repoPath,
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

export function StudioSetupFields() {
  return null
}
