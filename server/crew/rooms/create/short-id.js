import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

// 房间短 id 同时是工作区目录和分支名。旧的 6 位短 id 在多次建房后可能撞上残留目录，
// 这里先查房间、源目录和 scratch 目录，再确定新 id。
export const uniqueRoomShort = ({ store, workspace, provider, attempts = 20, uuid = randomUUID }) => {
  const scratch = typeof provider?.scratchRoot === 'function'
    ? provider.scratchRoot()
    : workspace.default.scratchRoot()
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const short = uuid().slice(0, 8)
    if (store.readRoom(`room-${short}`) !== null) continue
    if (workspace.exists(join(workspace.root(), `room-${short}`))) continue
    if (workspace.exists(join(scratch, short))) continue
    return short
  }
  throw new Error('没能分配一个空的房间目录')
}
