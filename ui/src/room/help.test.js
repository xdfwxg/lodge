import assert from 'node:assert/strict'
import test from 'node:test'
import { HELP_TOPICS } from './help.js'

test('the first-run help explains both rooms and that they do not switch', () => {
  const titles = HELP_TOPICS.map(([title]) => title)
  for (const title of ['聊天室', '工作室', '两种房间', '成员']) {
    assert.ok(titles.includes(title), `help is missing ${title}`)
  }
  const rooms = HELP_TOPICS.find(([title]) => title === '两种房间')?.[1] ?? ''
  assert.match(rooms, /之后不切换/)
})
