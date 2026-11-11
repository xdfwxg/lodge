import { independenceLabel } from './digest.js'
import { fail, ok } from './result.js'

// 演示房间：模拟数据只进 SQLite/SSE，不写仓库、不产生 commit。
export const simulateRoom = ({ readMessages, appendMessage, room }) => {
  if (room.demo !== true) return fail('conflict', '只有演示房间能模拟执行')
  const index = room.stages.findIndex(stage => stage.state === 'active' && stage.kind === 'deliverable')
  if (index < 0) return fail('conflict', '当前没有等待证据的交付阶段')
  const stage = room.stages[index]
  const command = stage.acceptance ?? 'npm test'
  const already = readMessages(room.id).some(message => (
    message.kind === 'verdict' && message.meta?.pass === true && message.meta?.stage === index
  ))
  if (already) return fail('conflict', '本阶段已经有 PASS 了')

  appendMessage(room.id, {
    kind: 'evidence',
    authorId: 'executor',
    text: `演示：模拟执行 \`${command}\`，退出码 0。这一条没有真实跑过命令。`,
    meta: {
      command,
      exit: 0,
      stage: index,
      output: 'demo output (simulated)',
      simulated: true,
      sample: true,
    },
  })
  appendMessage(room.id, {
    kind: 'verdict',
    authorId: 'verifier',
    text: `演示：模拟复核 PASS，未读取真实 diff。独立性：${independenceLabel(room)}。`,
    meta: { pass: true, stage: index, simulated: true },
  })
  return ok({ room })
}
