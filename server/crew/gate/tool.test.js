import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureGateServer, roomToolsFor } from './tool.js'

test('the gate server is registered once and only planners and verifiers load it', async () => {
  const servers = []
  const created = []
  const engine = {
    mcp: {
      list: async () => ({ servers }),
      create: async payload => {
        created.push(payload)
        servers.push({
          name: payload.name,
          command: payload.command,
          args: payload.args,
          enabled: true,
        })
        return { ok: true }
      },
      update: async () => ({ ok: true }),
      patch: async () => ({ ok: true }),
    },
  }
  assert.equal(await ensureGateServer(engine), true)
  assert.equal(created.length, 1)
  assert.equal(created[0].name, 'lodge_gate')
  assert.equal(created[0].enabled, true)
  assert.equal(await ensureGateServer(engine), true)
  assert.equal(created.length, 1)

  assert.deepEqual(roomToolsFor({ role: 'lead' }), ['lodge_gate'])
  assert.deepEqual(roomToolsFor({ role: 'verifier' }), ['lodge_gate'])
  assert.deepEqual(roomToolsFor({ role: 'worker' }), [])
})
