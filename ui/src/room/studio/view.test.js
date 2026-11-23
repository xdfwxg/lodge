import assert from 'node:assert/strict'
import test from 'node:test'
import { studioView } from './view.js'

const actions = {
  retry: () => {},
  verify: () => {},
  rework: () => {},
  selectRoom: () => {},
  swapBody: () => {},
  resume: () => {},
}

test('a studio connection signal retries the room instead of opening the panel', () => {
  let resumed = 0
  const tree = studioView.header({
    room: {
      id: 'room-studio',
      name: '写欢迎语',
      state: 'active',
      live: true,
      stages: [],
      messages: [],
      needsYou: { kind: 'connection', label: '连接断了' },
    },
    actions: { ...actions, resume: () => { resumed += 1 } },
  })
  const island = tree.props.children.find(node => typeof node?.props?.onSignalAction === 'function')
  assert.ok(island)
  assert.equal(island.props.onSignalAction({ needs: 'connection' }, {}), true)
  assert.equal(resumed, 1)
  assert.equal(island.props.onSignalAction({ needs: 'decision' }, {}), false)
})
