import { join } from 'node:path'

const ttlDays = () => {
  const value = Number(process.env.CREW_WORKTREE_TTL_DAYS ?? 7)
  return Number.isFinite(value) && value >= 0 ? value : 7
}

// 启动与定时 GC：完成/停止的房间清掉非交付席位工作区；孤儿工作区目录超过 TTL 才删。
export const collectWorkspaceGarbage = ({
  store,
  workspace,
  files,
  rootPath = workspace.default.scratchRoot(),
  ttlMs = ttlDays() * 24 * 60 * 60 * 1000,
  now = Date.now(),
  removeOrphans = process.env.CREW_WORKTREE_GC_ORPHANS === '1',
} = {}) => {
  let pruned = 0
  let orphans = 0

  for (const room of store.readRooms()) {
    if (room.state !== 'complete' && room.state !== 'stopped') continue
    const seats = workspace.provider(room).pruneSeats(room)
    const fresh = seats.filter(seat => !(room.prunedSeats ?? []).includes(seat))
    if (fresh.length === 0) continue
    const updated = store.updateRoom(room.id, current => {
      current.prunedSeats = seats
      return { events: [{ type: 'room.prune', payload: { seats: fresh } }] }
    })
    if (updated !== null) pruned += fresh.length
  }

  // 未知目录可能属于另一个 data dir；孤儿清理默认关闭，显式开启才删。
  if (!removeOrphans || !files.exists(rootPath)) return { pruned, orphans }
  for (const name of files.list(rootPath)) {
    const path = join(rootPath, name)
    let directory = false
    let mtimeMs = 0
    try {
      directory = files.isDirectory(path)
      mtimeMs = files.mtimeMs(path)
    } catch {
      continue
    }
    if (!directory) continue
    if (store.readRoom(`room-${name}`) !== null) continue
    if (now - mtimeMs < ttlMs) continue
    try {
      files.remove(path)
      orphans += 1
    } catch {}
  }
  return { pruned, orphans }
}
