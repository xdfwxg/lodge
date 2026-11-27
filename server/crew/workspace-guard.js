import { restoreWorktree, snapshotWorktrees } from './workspace-git.js'

// 成员 shell 的工作副本边界：一个人说话时，别人的工作树应当保持原样。
// 基座没有 OS 沙箱时，这里在每回合结束后对账；越界改动退回，并留下一条系统消息。
// 它挡不住家目录和房间之外的绝对路径，只守住房间自己的工作树。
const baselines = new Map()

export const beginWriteGuard = room => {
  if (room?.workspace?.provider !== 'git') return
  const entries = snapshotWorktrees(room)
  if (entries.size > 0) baselines.set(room.id, entries)
}

export const resetWriteGuard = roomId => {
  baselines.delete(roomId)
}

// 规划师和验收员只读：他们的副本和别人的副本都不该留下改动。
export const isReadOnlyRole = (room, memberId) => (room?.members ?? []).some(member => (
  member.id === memberId && (
    member.roleKind === 'planner' ||
    member.roleKind === 'verifier' ||
    member.role === 'lead'
  )
))

// 只读角色改了别人的工作树、又因为对方本来有改动而退不回去：这一轮不能继续，交给人。
// 自己的副本里写临时文件不算越界：那些文件不进交付，回合后能清掉就清，清不掉也不该拦停。
export const unreturnedReadOnlyViolations = ({ room, memberId, violations }) => (
  isReadOnlyRole(room, memberId)
    ? (Array.isArray(violations) ? violations : []).filter(item => item.memberId !== memberId && item.reverted !== true)
    : []
)

// 只对账“别人”的工作树；当前说话人的改动是本职，下一回合会连同基线一起更新。
// 并行派发时别人的树本来就在变，跨人对账会把队友的正常改动算成越界；这时只看说话人自己的树。
export const guardTurn = (room, actingMemberId, { others = true } = {}) => {
  if (room?.workspace?.provider !== 'git') return []
  const current = snapshotWorktrees(room)
  if (current.size === 0) return []
  const baseline = baselines.get(room.id)
  if (baseline === undefined) {
    baselines.set(room.id, current)
    return []
  }
  const violations = []
  for (const [memberId, now] of current) {
    // 规划师和验收员的副本只读；即使这一回合说话的是他们，也不能把改动留在里面。
    if (memberId === actingMemberId && !isReadOnlyRole(room, memberId)) continue
    if (!others && memberId !== actingMemberId) continue
    const before = baseline.get(memberId)
    if (before === undefined) continue
    if (now.head === before.head && now.status === before.status) continue
    let reverted = false
    // 基线是干净的才敢回退；本来就带着改动的工作树，交给人看。
    if (before.status === '' && now.head === before.head) {
      try {
        restoreWorktree(now.path, before.head)
        reverted = true
      } catch {}
    }
    violations.push({
      memberId,
      path: now.path,
      files: now.status.split('\n').filter(Boolean).slice(0, 20),
      reverted,
    })
  }
  baselines.set(room.id, snapshotWorktrees(room))
  return violations
}
