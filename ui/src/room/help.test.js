import assert from 'node:assert/strict'
import test from 'node:test'
import { HELP_TOPICS } from './help.js'

test('the first-run help explains both modes, switching and members', () => {
  const titles = HELP_TOPICS.map(([title]) => title)
  for (const title of ['聊天室', '工作室', '换模式', '成员']) {
    assert.ok(titles.includes(title), `help is missing ${title}`)
  }
})
