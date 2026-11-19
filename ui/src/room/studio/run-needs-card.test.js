import assert from 'node:assert/strict'
import test from 'node:test'
import { RunNeedsCard } from './run-needs-card.js'

const text = node => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  return [].concat(node.props?.children ?? []).map(text).join('')
}
const find = (node, match) => {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (match(node)) return node
  for (const child of [].concat(node.props?.children ?? [])) {
    const found = find(child, match)
    if (found !== null) return found
  }
  return null
}

test('a paused routine run lands on the goal room with its reason and one action', () => {
  const opened = []
  const tree = RunNeedsCard({
    needs: {
      label: '今天这次需要你',
      reason: '执行官的登录失效了',
      detail: '处理完成后点“继续”。',
      runId: 'run-1',
      action: 'error',
    },
    onOpenRun: id => opened.push(id),
  })
  assert.match(text(tree), /今天这次需要你/)
  assert.match(text(tree), /执行官的登录失效了/)
  assert.match(text(tree), /处理完成后点“继续”/)
  const action = find(tree, node => node.type === 'button' && text(node) === '去处理')
  assert.notEqual(action, null)
  action.props.onClick()
  assert.deepEqual(opened, ['run-1'])
})

test('an approval names the action instead of saying “handle it”', () => {
  const tree = RunNeedsCard({
    needs: {
      label: '这次需要你',
      reason: '有一个操作要你点头',
      runId: 'run-1',
      action: 'approval',
    },
    onOpenRun: () => {},
  })
  assert.notEqual(find(tree, node => node.type === 'button' && text(node) === '去确认'), null)
})
