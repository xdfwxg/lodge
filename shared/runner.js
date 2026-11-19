// 执行在 Runner，观看和决定可以在 Device。现在两者都由同一台 Mac 担任，
// 但房间协议先按这个边界写，以后加手机/远程查看不用改房间模型。
export const ACTOR_ROLE = Object.freeze({
  RUNNER: 'runner',
  DEVICE: 'device',
})

export const actorOf = ({ role, id = null, name = '' } = {}) => ({
  role: role === ACTOR_ROLE.RUNNER ? ACTOR_ROLE.RUNNER : ACTOR_ROLE.DEVICE,
  id: typeof id === 'string' && id !== '' ? id : null,
  name: typeof name === 'string' ? name : '',
})

export const canExecute = actor => actor?.role === ACTOR_ROLE.RUNNER
export const canDecide = actor => (
  actor?.role === ACTOR_ROLE.DEVICE || actor?.role === ACTOR_ROLE.RUNNER
)
