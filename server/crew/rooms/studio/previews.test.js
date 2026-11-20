import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ensurePreviews, htmlFilesOf } from './previews.js'

test('only html deliverables become visual evidence', () => {
  assert.deepEqual(htmlFilesOf(['a.html', 'design.md', 'b.htm', 'c.css']), ['a.html', 'b.htm'])
})

test('an html deliverable is captured once and remembered on the room', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'lodge-preview-'))
  try {
    mkdirSync(join(repo, 'out'), { recursive: true })
    writeFileSync(join(repo, 'out', 'members.html'), '<html></html>')
    let room = { id: 'room-p', repoPath: repo, previews: [] }
    const evidence = { id: 'ev-1', meta: { changedFiles: ['out/members.html'] } }
    const uploads = []
    const result = await ensurePreviews({
      room,
      stageIndex: 1,
      evidence,
      capture: async ({ out }) => {
        writeFileSync(out, Buffer.from([1, 2, 3]))
        return out
      },
      attachments: {
        uploadImage: async bytes => {
          uploads.push(bytes.length)
          return { path: '/tmp/attachments/00000000-0000-4000-8000-000000000000.png', mime: 'image/png', bytes: bytes.length }
        },
      },
      updateRoom: (id, mutate) => {
        mutate(room)
        return room
      },
    })
    assert.equal(result.length, 1)
    assert.equal(result[0].label, 'out/members.html')
    assert.deepEqual(uploads, [3])
    assert.equal(room.previews.length, 1)
    // 同一份证据不重复截。
    const again = await ensurePreviews({
      room,
      stageIndex: 1,
      evidence,
      capture: async () => null,
      attachments: { uploadImage: async () => null },
      updateRoom: () => room,
    })
    assert.equal(again.length, 1)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
