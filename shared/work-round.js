export const ROUND_FIELDS = Object.freeze([
  'goal',
  'plan',
  'stages',
  'gate',
  'shadowReview',
  'orchestration',
  'constraints',
  'usage',
  'budgetMicroUsd',
  'openQuestion',
  'lastPlannerDecision',
  'pendingDecision',
  'planRejections',
  'autoCheck',
  'stopAdvice',
  'blocked',
  'mergeConflict',
  'mergeResolved',
  'advisorShadow',
  'previews',
  'reviewRetriedAt',
  'stageDiagnostics',
  'stageBases',
  'stageBaseManifests',
  'startHead',
  'workspaceHead',
  'completedAt',
  'completedCommit',
  'completion',
  'decisions',
  'origin',
  'previousRoundId',
  'supersededByRoundId',
  'supersedeReason',
])

export const workRoundIdOf = value => (
  typeof value?.workRoundId === 'string' && value.workRoundId !== ''
    ? value.workRoundId
    : typeof value?.meta?.workRoundId === 'string' && value.meta.workRoundId !== ''
      ? value.meta.workRoundId
      : null
)
