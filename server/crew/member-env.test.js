import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { memberEnvFile, writeMemberEnv } from './member-env.js'

test('a member gets its own env file, data directory and port', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-member-env-'))
  try {
    const result = writeMemberEnv({
      room: { id: 'room-1' },
      memberId: 'verifier-2',
      path: root,
      port: 4321,
    })
    assert.equal(result.file, join(root, '.lodge', 'env'))
    assert.equal(memberEnvFile(root), result.file)
    assert.equal(existsSync(join(root, '.lodge', 'member-data')), true)
    assert.equal(existsSync(join(root, '.lodge', 'tmp')), true)
    const text = readFileSync(result.file, 'utf8')
    assert.match(text, /LODGE_ROOM_ID=room-1/)
    assert.match(text, /LODGE_MEMBER_ID=verifier-2/)
    assert.match(text, /PORT=4321/)
    assert.match(text, /LODGE_MEMBER_DATA_DIR=\.lodge\/member-data/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
