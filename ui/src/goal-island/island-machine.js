// The island's attention states. A milestone peeks and expires; a decision
// stays until it is handled or dismissed. Only one signal is shown at a time.

export const PEEK_MS = 4500

export const initialIslandState = {
  mode: 'closed',
  signal: null,
  decision: null,
  dismissed: null,
  expiresAt: null,
}

const closed = { mode: 'closed', signal: null, expiresAt: null }

export const reduceIsland = (state, action) => {
  switch (action.type) {
    case 'reset':
      return { ...initialIslandState }
    case 'snapshot': {
      const decision = action.decision ?? null
      const milestone = action.milestone ?? null
      const dismissed = state.dismissed !== null && decision?.key === state.dismissed
        ? state.dismissed
        : null
      if (state.mode === 'open') return { ...state, decision, dismissed }
      if (decision !== null && decision.key !== dismissed) {
        return { ...state, mode: 'decision', signal: decision, decision, dismissed, expiresAt: null }
      }
      if (milestone !== null) {
        return { ...state, mode: 'peek', signal: milestone, decision, dismissed, expiresAt: action.now + PEEK_MS }
      }
      if (decision === null && state.mode === 'decision') {
        return { ...state, ...closed, decision: null, dismissed: null }
      }
      return { ...state, decision, dismissed }
    }
    case 'open':
      return { ...state, mode: 'open', signal: null, expiresAt: null }
    case 'close': {
      const decision = action.decision ?? state.decision
      if (decision !== null && decision.key !== state.dismissed) {
        return { ...state, mode: 'decision', signal: decision, decision, expiresAt: null }
      }
      return { ...state, ...closed, decision: null }
    }
    case 'dismiss': {
      const key = state.signal?.key ?? state.decision?.key ?? null
      if (key === null) return state
      return { ...state, ...closed, dismissed: key }
    }
    case 'elapse':
      if (state.mode !== 'peek' || state.signal?.key !== action.key) return state
      return { ...state, ...closed }
    case 'resume':
      if (state.mode !== 'peek') return { ...state, expiresAt: null }
      return { ...state, expiresAt: action.now + Math.max(0, action.remaining ?? PEEK_MS) }
    default:
      return state
  }
}

export const peekRemaining = (expiresAt, now = Date.now()) => (
  typeof expiresAt === 'number' ? Math.max(0, expiresAt - now) : 0
)
