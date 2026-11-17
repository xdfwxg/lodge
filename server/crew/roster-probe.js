import { supportsRuntime } from './runtime-port.js'

const RECOMMEND_TIMEOUT = 90_000
const POLL_MS = 1_000

// 编队建议需要一个一次性的基座探针；房间、成员和回复形状都留在这个适配层。
export const createRosterProbe = ({ engine }) => {
  let member = null
  let room = null

  const waitForTurn = async sessionRef => {
    const deadline = Date.now() + RECOMMEND_TIMEOUT
    while (Date.now() < deadline) {
      const { messages } = await engine.history(sessionRef, { limit: 100 })
      const turn = [...messages].reverse().find(message => (
        message.kind === 'turn' &&
        typeof message.turn?.reply === 'string' &&
        message.turn.reply.trim() !== ''
      ))
      if (turn !== undefined) {
        const candidates = [
          turn.turn.reply,
          ...messages
            .filter(message => message.kind === 'text' && message.role === 'agent' && typeof message.text === 'string')
            .map(message => message.text),
        ].filter(text => text.trim() !== '')
        const withMembers = candidates.filter(text => text.includes('"members"'))
        const pool = withMembers.length > 0 ? withMembers : candidates
        return pool.sort((a, b) => b.length - a.length)[0] ?? turn.turn.reply
      }
      const failed = [...messages].reverse().find(message => (
        message.kind === 'activity' && message.meta?.ok === false
      ))
      if (failed !== undefined) throw new Error(`Lodge 生成方案失败：${failed.text}`)
      await new Promise(resolve => setTimeout(resolve, POLL_MS))
    }
    throw new Error('Lodge 在 90 秒内没有给出方案，请重试')
  }

  return {
    available: () => engine.capabilities().provisioning === true,
    health: () => engine.health(),
    start: async ({ name, soul, description, approval, mcp = [], roomName, goal, bulletin, cwd }) => {
      member = await engine.createMemberBot({ name, soul, description, approval, mcp })
      room = await engine.createRoom({
        name: roomName,
        goal,
        bulletin,
        members: [member.id],
        cwd,
        leadId: member.id,
      })
    },
    ask: async prompt => {
      if (room === null) throw new Error('编队探针还没有启动')
      await engine.sendTurn({ roomId: room.id, text: prompt })
      return waitForTurn(room.sessionRef)
    },
    stop: async () => {
      if (room !== null) {
        if (supportsRuntime(engine, 'cancel')) {
          try { await engine.cancelTurn({ roomId: room.id }) } catch {}
        }
        try { await engine.deleteRoom(room.id) } catch {}
        room = null
      }
      if (member !== null) {
        try { await engine.deleteMemberBot(member.id) } catch {}
        member = null
      }
    },
  }
}
