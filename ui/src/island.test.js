import assert from 'node:assert/strict'
import test from 'node:test'
import { Island } from './island.js'

test('the island renders its title, status and tone', () => {
  const tree = Island({ title: '圆桌', status: '正在聊', tone: 'active', titleText: '讨论交付边界' })
  assert.equal(tree.props.className, 'crew-island-wrap')
  const pill = tree.props.children
  assert.equal(pill.props.className, 'crew-island')
  assert.equal(pill.props['data-tone'], 'active')
  assert.equal(pill.props.title, '讨论交付边界')
  const [row, detail, footer] = pill.props.children
  assert.equal(row.props.className, 'crew-island-row')
  const [icon, title, status] = row.props.children
  assert.equal(icon, null)
  assert.equal(title.props.className, 'crew-island-title')
  assert.equal(title.props.children, '圆桌')
  assert.equal(status.props.className, 'crew-island-status')
  assert.equal(status.props.children, '正在聊')
  assert.equal(detail, null)
  assert.equal(footer, null)
})

test('detail and footer grow the same island', () => {
  const tree = Island({ title: '圆桌', status: '待确认', detail: '一句结论', footer: '一个动作' })
  const pill = tree.props.children
  assert.equal(pill.props['data-expanded'], 'true')
  const [row, detail, footer] = pill.props.children
  assert.equal(row.props.className, 'crew-island-row')
  assert.equal(detail.props.className, 'crew-island-detail')
  assert.equal(detail.props.children, '一句结论')
  assert.equal(footer.props.className, 'crew-island-foot')
  assert.equal(footer.props.children, '一个动作')
})

test('the island leaves out an empty status', () => {
  const tree = Island({ title: '圆桌', status: '' })
  const [row] = tree.props.children.props.children
  const [, , status] = row.props.children
  assert.equal(status, null)
})
