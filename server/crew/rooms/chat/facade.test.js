import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_DTO_VERSION, chatFacade } from './facade.js'

test('chat facade exposes a versioned, slim DTO', () => {
  const room = {
    chat: { round: 2, phase: 'awaiting_decision', turns: 4, turnLimit: 4, accepted: false, running: false, speaker: 'worker' },
    chatHost: { memberRef: 'host-1', name: 'LodgeHost' },
  }
  assert.equal(chatFacade.runningOf(room), false)
  assert.equal(chatFacade.speakerOf(room), 'worker')
  assert.equal(chatFacade.hostOf(room).memberRef, 'host-1')
  assert.equal(chatFacade.displayHostOf(room).displayName, 'Lodge 主持')
  assert.deepEqual(chatFacade.snapshot(room), {
    version: CHAT_DTO_VERSION,
    state: 'awaiting_decision',
    round: 2,
    phase: 'awaiting_decision',
    turns: 4,
    turnLimit: 4,
    conclusionId: null,
    accepted: false,
    running: false,
    speaker: 'worker',
    host: { memberRef: 'host-1', name: 'LodgeHost', displayName: 'Lodge 主持' },
  })
  assert.equal(chatFacade.snapshot({ roomType: 'studio' }), null)
})
