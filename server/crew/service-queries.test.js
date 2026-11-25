import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceQueries } from './service-queries.js'

const serviceOf = () => createServiceQueries({
  store: {},
  engine: { health: async () => ({ ok: true }) },
  roles: null,
  roomFiles: null,
  files: null,
})

test('health says whether the verifier probe can inject a defect', async () => {
  const previous = process.env.LODGE_PROBE_REVIEW_PATCH_DIR
  try {
    delete process.env.LODGE_PROBE_REVIEW_PATCH_DIR
    assert.equal((await serviceOf().health()).body.probes.reviewPatch, false)
    process.env.LODGE_PROBE_REVIEW_PATCH_DIR = '/tmp/lodge-probe-patches'
    assert.equal((await serviceOf().health()).body.probes.reviewPatch, true)
  } finally {
    if (previous === undefined) delete process.env.LODGE_PROBE_REVIEW_PATCH_DIR
    else process.env.LODGE_PROBE_REVIEW_PATCH_DIR = previous
  }
})
