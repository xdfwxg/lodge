export const ROUND_FIELDS = Object.freeze([
  'goal',
  'plan',
  'stages',
  'gate',
  'closure',
  'verificationMode',
  'shadowReview',
  'orchestration',
  'constraints',
  'usage',
  'openQuestion',
  'lastPlannerDecision',
  'autoCheck',
  'blocked',
  'mergeConflict',
  'stageBases',
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

export const ROUND_STATUS = Object.freeze({
  planning: 'planning',
  active: 'active',
  completed: 'completed',
  rejected: 'rejected',
  superseded: 'superseded',
  stopped: 'stopped',
})

export const OPEN_ROUND_STATUSES = new Set([ROUND_STATUS.planning, ROUND_STATUS.active])

export const MAX_ROUND_QUESTIONS = 2
export const MIN_ROUND_OPTIONS = 2
export const MAX_ROUND_OPTIONS = 4

export const workRoundIdOf = value => (
  typeof value?.workRoundId === 'string' && value.workRoundId !== ''
    ? value.workRoundId
    : typeof value?.meta?.workRoundId === 'string' && value.meta.workRoundId !== ''
      ? value.meta.workRoundId
      : null
)
