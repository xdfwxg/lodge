import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { seatEnvFile, writeSeatEnv } from './seat-env.js'

test('a seat gets its own env file, data directory and port', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-seat-env-'))
  try {
    const result = writeSeatEnv({
      room: { id: 'room-1' },
      seatId: 'verifier-2',
      path: root,
      port: 4321,
    })
    assert.equal(result.file, join(root, '.lodge', 'env'))
    assert.equal(seatEnvFile(root), result.file)
    assert.equal(existsSync(join(root, '.lodge', 'seat-data')), true)
    assert.equal(existsSync(join(root, '.lodge', 'tmp')), true)
    const text = readFileSync(result.file, 'utf8')
    assert.match(text, /LODGE_ROOM_ID=room-1/)
    assert.match(text, /LODGE_SEAT_ID=verifier-2/)
    assert.match(text, /PORT=4321/)
    assert.match(text, /LODGE_SEAT_DATA_DIR=\.lodge\/seat-data/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
