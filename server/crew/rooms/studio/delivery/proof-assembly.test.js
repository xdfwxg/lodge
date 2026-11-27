import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parkPackageProof } from './proof-assembly.js'

const temp = () => mkdtempSync(join(tmpdir(), 'lodge-proof-asm-'))

test('a worker’s root proof becomes its package part before the candidate is committed', () => {
  const dir = temp()
  try {
    writeFileSync(join(dir, 'lodge-proof.json'), JSON.stringify({ entry: 'node check.mjs', steps: [] }))
    assert.equal(parkPackageProof({ path: dir, index: 1 }), true)
    assert.equal(existsSync(join(dir, 'lodge-proof.json')), false)
    assert.equal(JSON.parse(readFileSync(join(dir, 'lodge-proof/2.json'), 'utf8')).entry, 'node check.mjs')
    // 已经是分片就不再动；没有根证明也不凭空造。
    assert.equal(parkPackageProof({ path: dir, index: 1 }), false)
    assert.equal(parkPackageProof({ path: dir, index: 0 }), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
