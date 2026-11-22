import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { STATUS_LABELS, copyIssueOf, copyStringsInSource } from '../../shared/product-copy.js'
import { t } from './goal-island/copy.js'
import { buildIdleDecision } from './room/decision.js'
import { healthLineOf } from './room/health.js'
import { roomLabelOf } from './views/room-list.js'

const walk = directory => {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(path)
  }
  return files
}

test('user-visible UI copy avoids internal words and second-person status', () => {
  const issues = []
  for (const file of walk(join(process.cwd(), 'ui/src'))) {
    const source = readFileSync(file, 'utf8')
    for (const item of copyStringsInSource(source, { jsxText: true })) {
      const issue = copyIssueOf(item.text)
      if (issue !== null) issues.push(`${file}:${item.line} ${issue} · ${item.text}`)
    }
  }
  assert.deepEqual(issues, [])
})

test('the copy gate catches the words it is meant to stop', () => {
  assert.match(copyIssueOf('需要你'), /第二人称/)
  assert.match(copyIssueOf('这个基座'), /内部词/)
  assert.equal(copyIssueOf('待处理'), null)
})

test('every room status uses the shared status vocabulary', () => {
  const rooms = [
    { name: '房', state: 'active' },
    { name: '房', state: 'idle', workRound: { status: 'completed' } },
    { name: '房', state: 'idle', chat: { phase: 'concluded' }, modeCapabilities: { stages: false } },
    { name: '房', state: 'paused' },
    { name: '房', state: 'stopped' },
    { name: '房', state: 'idle', archivedAt: 1 },
    ...['result', 'signoff', 'review', 'decision', 'question', 'setup', 'rework', 'merge', 'parallel', 'approval', 'idle', 'error', 'mcp', 'connection', 'blocked', 'unknown-kind']
      .map(kind => ({ name: '房', state: 'active', needsYou: { kind } })),
  ]
  for (const room of rooms) {
    const label = roomLabelOf(room)
    const status = label.split('，').at(-1)
    assert.ok(STATUS_LABELS.includes(status), `${label} 不在状态词表里`)
    assert.equal(copyIssueOf(label), null, label)
  }
})

test('waiting, pause and health use short state words', () => {
  assert.equal(t('Waiting for you'), '待处理')
  assert.equal(t('Waiting for you · {title}', { title: '房' }), '待处理 · 房')
  assert.equal(t('Paused'), '已暂停')
  assert.equal(t('Stopped'), '已停止')
  assert.equal(healthLineOf({ needsYou: { label: '待确认' } }), '待处理：待确认')
  assert.equal(buildIdleDecision({ state: 'paused', pauseReason: 'mcp' }).title, '连接中断')
  assert.equal(buildIdleDecision({ state: 'paused', pauseReason: 'approval' }).title, '确认超时')
})
