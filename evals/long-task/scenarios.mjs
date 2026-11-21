import assert from 'node:assert/strict'
import { stopRound } from '../../server/crew/rounds/lifecycle.js'
import { usageBudgetExceeded } from '../../shared/usage.js'

const ROOM = 'room-long-task'

const seed = (store, repo) => {
  if (store.readRoom(ROOM) !== null) return store.readRoom(ROOM)
  return store.writeRoom({
    id: ROOM,
    kind: 'room',
    roomType: 'studio',
    name: '长任务',
    goal: '跨轮工作',
    state: 'idle',
    idle: true,
    activeRoundId: null,
    lastRoundId: null,
    members: [],
    repoPath: repo,
    sourceRepo: repo,
  })
}

const roundOf = (ordinal, status = 'active') => ({
  id: `round-${ordinal}`,
  roomId: ROOM,
  ordinal,
  status,
  goal: `第 ${ordinal} 轮`,
  stages: [{ title: '实现', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  plan: { done: [] },
})

const start = (store, ordinal) => {
  const started = store.startWorkRound({ roomId: ROOM, round: roundOf(ordinal) })
  assert.notEqual(started, null, `第 ${ordinal} 轮应该能开始`)
  return `round-${ordinal}`
}

const finish = (store, roundId, status = 'completed') => {
  const result = store.finishWorkRound({
    roomId: ROOM,
    roundId,
    status,
    eventType: `round.${status}`,
    idempotencyKey: `round-${status}:${roundId}`,
  })
  assert.notEqual(result, null, `${roundId} 应该能收口`)
  return result
}

const append = (store, roundId, text, kind = 'system') => store.appendMessage(ROOM, {
  kind,
  authorId: 'system',
  text,
  workRoundId: roundId,
})

const stop = async (store, reason = '停一下') => stopRound({
  store,
  live: { cancel: async () => ({}), detach: () => {} },
  emit: () => {},
  room: store.readRoom(ROOM),
  reason,
})

const messageTexts = (store, roundId) => store
  .readMessages(ROOM, { workRoundId: roundId })
  .map(message => message.text)

const metrics = (store, { human = 0 } = {}) => {
  const rounds = store.readWorkRounds(ROOM)
  const rework = store.readMessages(ROOM).filter(message => message.kind === 'rework').length
  const costMicroUsd = rounds.reduce((sum, round) => sum + (Number(round.usage?.costMicroUsd) || 0), 0)
  return {
    rounds: rounds.length,
    completed: rounds.filter(round => round.status === 'completed').length,
    rework,
    human,
    costMicroUsd,
  }
}

export const SCENARIOS = {
  'two-rounds': {
    first({ store, repo }) {
      seed(store, repo)
      const first = start(store, 1)
      append(store, first, '第一轮的内容')
      finish(store, first, 'completed')
      const second = start(store, 2)
      append(store, second, '第二轮还在')
      assert.equal(store.readRoom(ROOM).activeRoundId, second)
    },
    second({ store }) {
      assert.equal(store.readRoom(ROOM).activeRoundId, 'round-2')
      assert.deepEqual(messageTexts(store, 'round-1'), ['第一轮的内容'])
      assert.deepEqual(messageTexts(store, 'round-2'), ['第二轮还在'])
      assert.equal(store.readWorkRound('round-1').status, 'completed')
      finish(store, 'round-2', 'completed')
      assert.equal(store.readRoom(ROOM).state, 'idle')
      return metrics(store)
    },
  },

  'stop-next': {
    async first({ store, repo }) {
      seed(store, repo)
      const first = start(store, 1)
      append(store, first, '第一次尝试')
      store.enqueueWork({ roomId: ROOM, roundId: first, kind: 'round-work', payload: {} })
      const stopped = await stop(store)
      assert.equal(stopped.ok, true, stopped.error)
      assert.equal(store.readWorkRound(first).status, 'stopped')
      assert.equal(store.readRoom(ROOM).state, 'idle')
      const queued = store.readWork(ROOM).filter(item => item.round_id === first)
      assert.equal(queued.length, 1)
      assert.equal(queued[0].status, 'cancelled')
      start(store, 2)
    },
    second({ store }) {
      assert.equal(store.readWorkRound('round-1').status, 'stopped')
      assert.equal(store.readRoom(ROOM).activeRoundId, 'round-2')
      finish(store, 'round-2', 'completed')
      return metrics(store)
    },
  },

  'archive-restore': {
    async first({ store, repo }) {
      seed(store, repo)
      const first = start(store, 1)
      append(store, first, '归档前的内容')
      store.enqueueWork({ roomId: ROOM, roundId: first, kind: 'round-work', payload: {} })
      await stop(store, '房间已归档')
      store.updateRoom(ROOM, current => {
        current.archivedAt = Date.now()
        current.state = 'stopped'
        current.idle = false
        return { events: [] }
      })
      assert.notEqual(store.readRoom(ROOM).archivedAt, null)
    },
    second({ store }) {
      assert.notEqual(store.readRoom(ROOM).archivedAt, null)
      store.updateRoom(ROOM, current => {
        current.archivedAt = null
        current.state = 'idle'
        current.idle = true
        return { events: [] }
      })
      const second = start(store, 2)
      assert.equal(store.readRoom(ROOM).activeRoundId, second)
      assert.deepEqual(messageTexts(store, 'round-1'), ['归档前的内容'])
      assert.equal(store.readWorkRound('round-1').status, 'stopped')
      finish(store, second, 'completed')
      return metrics(store)
    },
  },

  budget: {
    first({ store, repo }) {
      seed(store, repo)
      const first = start(store, 1)
      store.updateRound(ROOM, current => {
        current.usage = { version: 1, turns: 1, tokens: { input: 10, output: 5 }, costMicroUsd: 5_000, costStatus: 'reported' }
        current.budgetMicroUsd = 5_000
        return { events: [] }
      })
      store.updateRoom(ROOM, current => {
        current.state = 'paused'
        current.pauseReason = 'budget'
        current.idle = false
        return { events: [] }
      })
      assert.equal(usageBudgetExceeded(store.readRoom(ROOM)), true)
    },
    second({ store }) {
      const room = store.readRoom(ROOM)
      assert.equal(room.state, 'paused')
      assert.equal(room.pauseReason, 'budget')
      assert.equal(usageBudgetExceeded(room), true)
      assert.equal(room.activeRoundId, 'round-1')
      return metrics(store)
    },
  },

  'human-gate': {
    first({ store, repo }) {
      seed(store, repo)
      const first = start(store, 1)
      store.updateRound(ROOM, current => {
        current.lastPlannerDecision = {
          stage: 0,
          verdictId: 'verdict-1',
          kind: 'human',
          judgment: { decision: 'human', reason: '验收证据不够', actionRequired: '选择返工或接手' },
          at: Date.now(),
        }
        return { events: [] }
      })
      append(store, first, '验收退回，等规划师决定', 'rework')
      append(store, first, '这一轮交给人', 'system')
    },
    second({ store }) {
      const round = store.readWorkRound('round-1')
      assert.equal(round.lastPlannerDecision?.kind, 'human')
      assert.equal(store.readRoom(ROOM).activeRoundId, 'round-1')
      finish(store, 'round-1', 'rejected')
      return metrics(store, { human: 1 })
    },
  },
}

export const SCENARIO_IDS = Object.keys(SCENARIOS)
