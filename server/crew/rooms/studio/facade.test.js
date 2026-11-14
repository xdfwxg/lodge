import assert from 'node:assert/strict'
import test from 'node:test'
import { STUDIO_DTO_VERSION, studioFacade } from './facade.js'

test('studio facade exposes a versioned, slim DTO', () => {
  const room = {
    state: 'complete',
    closure: 'signed',
    stages: [{ id: 's1', title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'npm test' }],
    verifiers: ['verifier'],
  }
  assert.deepEqual(studioFacade.snapshot(room), {
    version: STUDIO_DTO_VERSION,
    state: 'signed',
    closure: 'signed',
    stages: [{ id: 's1', title: '实现', kind: 'deliverable', state: 'passed' }],
    verifiers: ['verifier'],
    delivery: true,
  })
  assert.equal(studioFacade.snapshot({ roomType: 'chat', chat: {} }), null)
})
