import assert from 'node:assert/strict'
import test from 'node:test'
import { RoomReview, reviewItemsOf } from './room-review.js'

const childrenOf = node => [].concat(node?.props?.children ?? node?.children ?? [])

const treeText = node => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  return childrenOf(node).map(treeText).join('')
}

test('room review keeps real friction and ignores repeated stage or todo projections', () => {
  const room = {
    issues: [
      { id: 'stage-1', kind: 'stage', title: '目标对齐', state: 'done' },
      { id: 'todo-1', kind: 'todo', title: '拿到路径', state: 'todo' },
    ],
    retro: { items: [{ kind: 'rework', text: '重做 2 次', suggestion: '把验收写成能跑的检查。' }] },
  }
  assert.deepEqual(reviewItemsOf(room).map(item => item.kind), ['rework'])
  const tree = RoomReview({ room, finished: true })
  assert.equal(tree.type, 'section')
  assert.match(treeText(tree), /重做 2 次/)
  assert.doesNotMatch(treeText(tree), /目标对齐|拿到路径/)
})

test('room review disappears when there is no real friction', () => {
  const tree = RoomReview({
    room: {
      issues: [{ id: 'todo-1', kind: 'todo', title: '拿到路径', state: 'todo' }],
      retro: { items: [] },
    },
    finished: true,
  })
  assert.equal(tree, null)
})

test('a chat conclusion keeps its review folded', () => {
  const tree = RoomReview({
    room: { retro: { items: [{ kind: 'rounds', text: '讨论用了 2 轮', suggestion: '开场先写判断标准。' }] } },
    finished: true,
    collapsible: true,
  })
  assert.equal(tree.type, 'details')
  const [summary] = childrenOf(tree)
  assert.equal(summary.type, 'summary')
  assert.equal(summary.props.children, '房间复盘')
})
