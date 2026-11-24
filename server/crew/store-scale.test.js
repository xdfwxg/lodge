// 规模与恢复：房间多、消息多、进程中途断掉时，SQLite 仍是唯一真相。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from './store.js'

const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-scale-'))
  return { dir, store: createStore({ dataDir: dir }) }
}

test('forty rooms with thousands of messages stay scoped, ordered and searchable', () => {
  const { dir, store } = temp()
  const rooms = 40
  const perRoom = 120
  try {
    for (let index = 0; index < rooms; index += 1) {
      store.writeRoom({
        id: `room-${index}`,
        name: `房间 ${index}`,
        goal: '规模测试',
        state: 'active',
        demo: true,
        stages: [],
        members: [],
      })
    }
    for (let index = 0; index < rooms; index += 1) {
      for (let line = 0; line < perRoom; line += 1) {
        store.appendMessage(`room-${index}`, {
          kind: 'system',
          text: `房间${index} 第${line}条 唯一词${index}`,
        })
      }
    }
    assert.equal(store.db.prepare('SELECT MAX(seq) AS seq FROM messages').get().seq, rooms * perRoom)
    assert.equal(store.maxMessageSeq('room-0'), perRoom)
    assert.equal(store.readMessages('room-7').length, perRoom)
    assert.deepEqual(
      store.readMessages('room-7').map(message => message.text).slice(0, 2),
      ['房间7 第0条 唯一词7', '房间7 第1条 唯一词7'],
    )
    assert.equal(store.readRecentMessages('room-7', 3).length, 3)
    assert.equal(store.readRecentMessages('room-7', 3).at(-1).text, '房间7 第119条 唯一词7')

    const hits = store.searchMessages('room-7', '唯一词7', { limit: 200 })
    assert.ok(hits.length > 0)
    assert.equal(hits.every(hit => store.readMessage('room-7', hit.id) !== null), true)

    // 查不到的词就是空结果，不能拿邻近房间的记录凑数。
    assert.deepEqual(store.searchMessages('room-7', '完全不存在的词'), [])

    store.deleteRoom('room-7')
    assert.deepEqual(store.searchMessages('room-7', '唯一词7'), [])
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a crash mid-round leaves one open round that can be finished after reopen', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({ id: 'room-1', name: '发布', goal: '把检查做出来', state: 'active', demo: true })
    const started = store.startWorkRound({
      roomId: 'room-1',
      round: { id: 'round-1', roomId: 'room-1', goal: '把检查做出来', stages: [{ title: '写清单' }] },
      message: { kind: 'system', text: '开始' },
    })
    assert.notEqual(started, null)

    // 模拟进程直接退出：不 finish、不清理，只关数据库。
    store.db.close()
    const reopened = createStore({ dataDir: dir })
    try {
      const room = reopened.readRoom('room-1')
      assert.equal(room.state, 'active')
      assert.equal(room.activeRoundId, 'round-1')
      assert.equal(room.workRound.status, 'planning')
      assert.equal(reopened.readMessages('room-1').length, 1)

      const finished = reopened.finishWorkRound({
        roomId: 'room-1',
        roundId: 'round-1',
        status: 'completed',
        patch: { conclusion: '做完了' },
      })
      assert.notEqual(finished, null)
      const open = reopened.db.prepare(
        "SELECT COUNT(*) AS n FROM work_round WHERE room_id = 'room-1' AND status IN ('planning', 'active')",
      ).get()
      assert.equal(open.n, 0)
    } finally {
      reopened.db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed round write rolls back the room, the round and the event together', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({ id: 'room-1', name: '发布', goal: '目标', state: 'active', demo: true })
    store.startWorkRound({
      roomId: 'room-1',
      round: { id: 'round-1', roomId: 'room-1', goal: '目标', stages: [] },
    })
    const beforeRoom = store.readRoom('room-1')
    const beforeRound = store.readWorkRound('round-1', 'room-1')
    const beforeEvents = store.readEvents('room-1').length

    assert.throws(() => store.updateRound('room-1', room => {
      room.goal = '改了'
      room.stages = [{ title: '新阶段' }]
      throw new Error('写一半就失败')
    }), /写一半就失败/)

    assert.equal(store.readRoom('room-1').goal, beforeRoom.goal)
    assert.equal(store.readWorkRound('round-1', 'room-1').version, beforeRound.version)
    assert.equal(store.readEvents('room-1').length, beforeEvents)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('two writers on the same store cannot lose each other\'s room updates', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({ id: 'room-1', name: '发布', goal: '目标', state: 'active', demo: true })
    const second = createStore({ dataDir: dir })
    try {
      const left = store.updateRoom('room-1', room => {
        room.name = '甲的更新'
        return { events: [{ type: 'room.renamed', payload: { name: room.name } }] }
      })
      assert.equal(left.name, '甲的更新')
      const right = second.updateRoom('room-1', room => {
        assert.equal(room.name, '甲的更新')
        room.name = '乙的更新'
        return true
      })
      assert.equal(right.name, '乙的更新')
      assert.equal(store.readRoom('room-1').version, 3)
      assert.deepEqual(store.readEvents('room-1').map(event => event.type), ['room.renamed'])
    } finally {
      second.db.close()
    }
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('base and send ids are found through their own indexes', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({ id: 'room-1', name: 'A', goal: 'g', state: 'active', demo: true })
    store.writeRoom({ id: 'room-2', name: 'B', goal: 'g', state: 'active', demo: true })
    const withBase = store.appendMessage('room-1', { kind: 'chat', text: '最终', meta: { baseId: 'base-1' } })
    const withSend = store.appendMessage('room-1', { kind: 'chat', text: '回显', meta: { sendId: 'send-1' } })

    assert.equal(store.findMessageByBaseId('room-1', 'base-1').id, withBase.id)
    assert.equal(store.findMessageBySendId('room-1', 'send-1').id, withSend.id)
    assert.equal(store.findMessageByBaseId('room-2', 'base-1'), null)
    assert.equal(store.findMessageByBaseId('room-1', ''), null)
    assert.equal(store.findMessageBySendId('room-1', 'missing'), null)

    const plan = store.db.prepare(
      "EXPLAIN QUERY PLAN SELECT payload FROM messages WHERE room_id = ? AND json_extract(payload, '$.meta.baseId') = ? ORDER BY seq DESC LIMIT 1",
    ).all('room-1', 'base-1').map(row => row.detail).join(' ')
    assert.match(plan, /messages_meta_base/)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a message and its search index move together', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({ id: 'room-1', name: '发布', goal: '目标', state: 'active', demo: true })
    store.appendMessage('room-1', { kind: 'system', text: '第一条证据' })
    // 同一条消息 id 再写一次会撞唯一索引；保存点必须把全文索引一起退回。
    const duplicate = { id: 'dup-1', kind: 'system', text: '重复证据' }
    store.upsertMessage({ ...duplicate, roomId: 'room-1' })
    assert.equal(store.searchMessages('room-1', '重复证据').length, 1)
    store.db.prepare('DELETE FROM message_fts WHERE message_id = ?').run('dup-1')
    assert.equal(store.searchMessages('room-1', '重复证据').length, 0)
    assert.equal(existsSync(join(dir, 'crew.db')), true)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
