import assert from 'node:assert/strict'
import test from 'node:test'
import {
  budgetStatus,
  budgetSummary,
  globalBudgetStatus,
  roomBudgetFromBody,
  DEFAULT_ROOM_BUDGET_USD,
} from './budget.js'

const room = (costMicroUsd, budgetMicroUsd) => ({ usage: { costMicroUsd, budgetMicroUsd } })

const withEnv = (value, run) => {
  const previous = process.env.CREW_GLOBAL_BUDGET_USD
  if (value === undefined) delete process.env.CREW_GLOBAL_BUDGET_USD
  else process.env.CREW_GLOBAL_BUDGET_USD = value
  try {
    run()
  } finally {
    if (previous === undefined) delete process.env.CREW_GLOBAL_BUDGET_USD
    else process.env.CREW_GLOBAL_BUDGET_USD = previous
  }
}

test('a room blocks new work at its hard cap', () => {
  const status = budgetStatus(room(1_000_000, 1_000_000), [])
  assert.equal(status.ok, false)
  assert.equal(status.roomBlocked, true)
  assert.match(status.message, /房间预算已用尽/)
})

test('zero means unlimited for a room budget', () => {
  const status = budgetStatus(room(9_000_000, 0), [])
  assert.equal(status.ok, true)
  assert.equal(status.roomBlocked, false)
})

test('the global cap sums every room', () => {
  withEnv('1', () => {
    const status = globalBudgetStatus([room(400_000, 0), room(600_000, 0)])
    assert.equal(status.ok, false)
    assert.equal(status.globalBlocked, true)
    assert.equal(status.globalSpent, 1_000_000)
    assert.match(status.message, /全局预算已用尽/)
  })
})

test('the global cap is opt-in and zero means unlimited', () => {
  withEnv(undefined, () => {
    assert.equal(globalBudgetStatus([room(9_000_000, 0)]).ok, true)
  })
  withEnv('0', () => {
    assert.equal(globalBudgetStatus([room(9_000_000, 0)]).ok, true)
  })
})

test('a new room takes its budget from the body or the default', () => {
  const previous = process.env.CREW_ROOM_BUDGET_USD
  delete process.env.CREW_ROOM_BUDGET_USD
  try {
    assert.equal(roomBudgetFromBody({ budgetUsd: 1.5 }), 1_500_000)
    assert.equal(roomBudgetFromBody({ budgetUsd: 0 }), 0)
    assert.equal(roomBudgetFromBody({}), DEFAULT_ROOM_BUDGET_USD * 1_000_000)
  } finally {
    if (previous !== undefined) process.env.CREW_ROOM_BUDGET_USD = previous
  }
})

test('a positive budget never rounds down to unlimited', () => {
  assert.equal(roomBudgetFromBody({ budgetUsd: 0.0000004 }), 1)
})

test('a zero room-budget env means unlimited for new rooms', () => {
  const previous = process.env.CREW_ROOM_BUDGET_USD
  process.env.CREW_ROOM_BUDGET_USD = '0'
  try {
    assert.equal(roomBudgetFromBody({}), 0)
  } finally {
    if (previous === undefined) delete process.env.CREW_ROOM_BUDGET_USD
    else process.env.CREW_ROOM_BUDGET_USD = previous
  }
})

test('the dispatch summary reports global spend and cap', () => {
  withEnv('2', () => {
    assert.deepEqual(budgetSummary([room(500_000, 0), room(250_000, 0)]), {
      globalSpentMicroUsd: 750_000,
      globalBudgetMicroUsd: 2_000_000,
    })
  })
})
