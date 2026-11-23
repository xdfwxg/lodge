// 所有持久状态和派生状态的唯一清单。其他模块引用这里的常量，不再各写一套字符串。

export const ROOM_STATE = Object.freeze({
  idle: 'idle',
  active: 'active',
  paused: 'paused',
  stopped: 'stopped',
})

export const ROOM_STATUS = Object.freeze({
  ...ROOM_STATE,
  archived: 'archived',
})

export const ROUND_STATUS = Object.freeze({
  planning: 'planning',
  active: 'active',
  completed: 'completed',
  rejected: 'rejected',
  failed: 'failed',
  superseded: 'superseded',
  stopped: 'stopped',
})

export const ROUND_EVENT = Object.freeze({
  activate: 'activate',
  complete: 'complete',
  reject: 'reject',
  fail: 'fail',
  supersede: 'supersede',
  stop: 'stop',
  resume: 'resume',
})

export const OPEN_ROUND_STATUSES = new Set([ROUND_STATUS.planning, ROUND_STATUS.active])
export const TERMINAL_ROUND_STATUSES = new Set([
  ROUND_STATUS.completed,
  ROUND_STATUS.rejected,
  ROUND_STATUS.failed,
  ROUND_STATUS.superseded,
  ROUND_STATUS.stopped,
])

export const ROUND_TRANSITIONS = Object.freeze({
  [ROUND_STATUS.planning]: Object.freeze({
    [ROUND_EVENT.activate]: ROUND_STATUS.active,
    [ROUND_EVENT.reject]: ROUND_STATUS.rejected,
    [ROUND_EVENT.stop]: ROUND_STATUS.stopped,
  }),
  [ROUND_STATUS.active]: Object.freeze({
    [ROUND_EVENT.complete]: ROUND_STATUS.completed,
    [ROUND_EVENT.reject]: ROUND_STATUS.rejected,
    [ROUND_EVENT.fail]: ROUND_STATUS.failed,
    [ROUND_EVENT.supersede]: ROUND_STATUS.superseded,
    [ROUND_EVENT.stop]: ROUND_STATUS.stopped,
  }),
  [ROUND_STATUS.completed]: Object.freeze({}),
  [ROUND_STATUS.rejected]: Object.freeze({}),
  [ROUND_STATUS.failed]: Object.freeze({}),
  [ROUND_STATUS.superseded]: Object.freeze({}),
  // 停下的一轮可以接回来：只有“继续”，不能直接完成或退回。
  [ROUND_STATUS.stopped]: Object.freeze({ [ROUND_EVENT.resume]: ROUND_STATUS.active }),
})

export const STAGE_STATE = Object.freeze({
  pending: 'pending',
  active: 'active',
  passed: 'passed',
})

export const STAGE_STATUS = Object.freeze({
  ...STAGE_STATE,
  blocked: 'blocked',
  waiting: 'waiting',
})

export const ASSIGNMENT_STATUS = Object.freeze({
  created: 'created',
  sent: 'sent',
  working: 'working',
  reported: 'reported',
  reviewing: 'reviewing',
  passed: 'passed',
  rejected: 'rejected',
  failed: 'failed',
  cancelled: 'cancelled',
})

export const ASSIGNMENT_STATUSES = new Set(Object.values(ASSIGNMENT_STATUS))

export const ASSIGNMENT_TERMINAL = new Set([
  ASSIGNMENT_STATUS.passed,
  ASSIGNMENT_STATUS.rejected,
  ASSIGNMENT_STATUS.failed,
  ASSIGNMENT_STATUS.cancelled,
])

export const ASSIGNMENT_TRANSITIONS = Object.freeze({
  [ASSIGNMENT_STATUS.created]: [ASSIGNMENT_STATUS.sent, ASSIGNMENT_STATUS.failed, ASSIGNMENT_STATUS.cancelled],
  [ASSIGNMENT_STATUS.sent]: [ASSIGNMENT_STATUS.working, ASSIGNMENT_STATUS.reported, ASSIGNMENT_STATUS.passed, ASSIGNMENT_STATUS.rejected, ASSIGNMENT_STATUS.failed, ASSIGNMENT_STATUS.cancelled],
  [ASSIGNMENT_STATUS.working]: [ASSIGNMENT_STATUS.reported, ASSIGNMENT_STATUS.passed, ASSIGNMENT_STATUS.rejected, ASSIGNMENT_STATUS.failed, ASSIGNMENT_STATUS.cancelled],
  [ASSIGNMENT_STATUS.reported]: [ASSIGNMENT_STATUS.reviewing, ASSIGNMENT_STATUS.passed, ASSIGNMENT_STATUS.rejected, ASSIGNMENT_STATUS.failed, ASSIGNMENT_STATUS.cancelled],
  [ASSIGNMENT_STATUS.reviewing]: [ASSIGNMENT_STATUS.passed, ASSIGNMENT_STATUS.rejected, ASSIGNMENT_STATUS.failed, ASSIGNMENT_STATUS.cancelled],
  [ASSIGNMENT_STATUS.passed]: [],
  [ASSIGNMENT_STATUS.rejected]: [ASSIGNMENT_STATUS.failed],
  [ASSIGNMENT_STATUS.failed]: [],
  [ASSIGNMENT_STATUS.cancelled]: [],
})

export const CHAT_PHASE = Object.freeze({
  discussing: 'discussing',
  summarizing: 'summarizing',
  concluded: 'concluded',
})

export const CHAT_EVENT = Object.freeze({
  summarize: 'summarize',
  conclude: 'conclude',
  continue_discuss: 'continue_discuss',
  abort: 'abort',
})

export const CHAT_STATUS = Object.freeze({
  ...CHAT_PHASE,
  idle: 'idle',
  running: 'running',
  thinking: 'thinking',
  paused: 'paused',
  stopped: 'stopped',
  archived: 'archived',
})

export const CHAT_TRANSITIONS = Object.freeze({
  [CHAT_PHASE.discussing]: Object.freeze({
    [CHAT_EVENT.summarize]: CHAT_PHASE.summarizing,
    [CHAT_EVENT.abort]: CHAT_PHASE.discussing,
  }),
  [CHAT_PHASE.summarizing]: Object.freeze({
    [CHAT_EVENT.conclude]: CHAT_PHASE.concluded,
    [CHAT_EVENT.abort]: CHAT_PHASE.discussing,
  }),
  [CHAT_PHASE.concluded]: Object.freeze({
    [CHAT_EVENT.continue_discuss]: CHAT_PHASE.discussing,
  }),
})

export const WORK_ITEM_STATUS = Object.freeze({
  pending: 'pending',
  leased: 'leased',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
})

export const APPROVAL_STATE = Object.freeze({
  pending: 'pending',
  allowed: 'allowed',
  denied: 'denied',
  expired: 'expired',
})

export const REVIEW_STATE = Object.freeze({
  none: 'none',
  pending: 'pending',
  pass: 'pass',
  reject: 'reject',
  failed: 'failed',
})

export const MEMORY_STATUS = Object.freeze({
  draft: 'draft',
  approved: 'approved',
  rejected: 'rejected',
  deleted: 'deleted',
})

export const ATTENTION_KIND = Object.freeze({
  approval: 'approval',
  question: 'question',
  connection: 'connection',
  blocked: 'blocked',
  mcp: 'mcp',
  error: 'error',
  idle: 'idle',
  decision: 'decision',
  'auto-check': 'auto-check',
  'review-timeout': 'review-timeout',
  rework: 'rework',
  review: 'review',
  signoff: 'signoff',
  budget: 'budget',
})

export const PAUSE_REASON = Object.freeze({
  member_error: 'member_error',
  approval: 'approval',
  budget: 'budget',
  mcp: 'mcp',
})

export const AUTO_CHECK_STATUS = Object.freeze({
  blocked: 'blocked',
  'limit-reached': 'limit-reached',
})

export const AUTO_CHECK_REASON = Object.freeze({
  'same-failure': 'same-failure',
  attempts: 'attempts',
  time: 'time',
  budget: 'budget',
})

export const BLOCKED_REASON = Object.freeze({
  'no-progress': 'no-progress',
  'check-failed': 'check-failed',
})

export const PLANNER_DECISION_KIND = Object.freeze({
  rework: 'rework',
  human: 'human',
})

export const ISSUE_STATE = Object.freeze({
  todo: 'todo',
  in_progress: 'in_progress',
  done: 'done',
  blocked: 'blocked',
})

export const HANDOFF_STATUS = Object.freeze({
  sending: 'sending',
  sent: 'sent',
  failed: 'failed',
})

// 可枚举的总目录：测试和排查都从这里看，不再靠搜字符串。
export const STATE_GROUPS = Object.freeze({
  roomState: ROOM_STATE,
  roomStatus: ROOM_STATUS,
  roundStatus: ROUND_STATUS,
  roundEvent: ROUND_EVENT,
  stageState: STAGE_STATE,
  stageStatus: STAGE_STATUS,
  assignmentStatus: ASSIGNMENT_STATUS,
  chatPhase: CHAT_PHASE,
  chatEvent: CHAT_EVENT,
  chatStatus: CHAT_STATUS,
  workItemStatus: WORK_ITEM_STATUS,
  approvalState: APPROVAL_STATE,
  reviewState: REVIEW_STATE,
  memoryStatus: MEMORY_STATUS,
  attentionKind: ATTENTION_KIND,
  pauseReason: PAUSE_REASON,
  autoCheckStatus: AUTO_CHECK_STATUS,
  autoCheckReason: AUTO_CHECK_REASON,
  blockedReason: BLOCKED_REASON,
  plannerDecisionKind: PLANNER_DECISION_KIND,
  issueState: ISSUE_STATE,
  handoffStatus: HANDOFF_STATUS,
})
