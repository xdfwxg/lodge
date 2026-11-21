import assert from 'node:assert/strict'
import test from 'node:test'
import { ROOM_ACTIONS } from '../route-table.js'
import { createCrewPorts } from './crew-ports.js'
import { createCrewService } from './service.js'

// 路由扫描：每个房间动作都要有处理器，并且在空请求下给出可读的业务结果，
// 不能抛异常、不能落成“方法不对”。它不调用模型，也不碰真实基座。
const roomRecord = () => ({
  id: 'room-1',
  kind: 'room',
  name: 'Sweep',
  goal: 'g',
  state: 'active',
  live: false,
  stages: [{ title: '实现', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  members: [],
  childRoomIds: [],
})

const setup = () => {
  let current = roomRecord()
  const store = {
    readRoom: () => current,
    readRooms: () => (current === null ? [] : [current]),
    readMessages: () => [],
    readMessagesSince: () => [],
    readEvidence: () => [],
    readAssignments: () => [],
    writeRoom: () => {},
    updateRound: (id, mutate) => {
      const next = structuredClone(current)
      const change = mutate(next)
      if (change === null || change === undefined || change === false) return null
      current = next
      return next
    },
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      const change = mutate(next)
      if (change === null || change === undefined || change === false) return null
      current = next
      return next
    },
    deleteRoom: () => {
      current = null
      return true
    },
    appendMessage: () => ({}),
    appendEvent: () => {},
  }
  const live = {
    isAttached: () => false,
    attach: async () => {},
    detach: () => {},
    cancel: async () => {},
    expireApprovals: async () => null,
    cancelQueued: async () => ({ cancelled: false, reason: 'not attached' }),
    steerQueued: async () => ({ ok: false }),
    holdMember: async () => null,
    sendToMember: async () => {},
    requestReview: async () => ({}),
    reworkStage: async () => {},
    resume: async () => {},
    decideApproval: async () => ({ ok: false, reason: 'not attached' }),
    answerCard: async () => ({ ok: false, reason: 'not attached' }),
  }
  const engine = {
    health: async () => ({}),
    instances: async () => [],
    capabilities: () => ({}),
    rooms: async () => [],
  }
  const service = createCrewService({
    store,
    engine,
    live,
    emit: () => {},
    roles: [],
    ports: createCrewPorts(),
  })
  return service
}

test('every room action has a handler that answers with a business result', async () => {
  for (const action of ROOM_ACTIONS) {
    const service = setup()
    let result
    try {
      result = await service.roomRequest('room-1', action, {
        method: 'POST',
        readBody: async () => ({}),
      })
    } catch (error) {
      assert.fail(`${action} threw: ${error?.stack ?? error}`)
    }
    assert.ok(result !== null && typeof result === 'object', `${action} returned ${result}`)
    assert.notEqual(result.error, '方法不对', `${action} has no handler`)
    assert.ok('ok' in result, `${action} returned no ok field: ${JSON.stringify(result)}`)
  }
})
