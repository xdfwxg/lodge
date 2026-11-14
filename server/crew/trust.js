export const TRUST_LEVELS = ['observe', 'verify', 'auto']
const DEFAULT_TRUST = 'verify'

export const trustLevelOf = room => (
  TRUST_LEVELS.includes(room?.trust) ? room.trust : DEFAULT_TRUST
)
