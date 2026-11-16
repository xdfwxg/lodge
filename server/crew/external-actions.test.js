import assert from 'node:assert/strict'
import test from 'node:test'
import { externalAction, pendingApprovals } from './external-actions.js'
import { reviewExternalAction } from './kernel/live/action-gate.js'

const card = (subtitle, tool = 'Bash') => ({ tool, action: 'exec', subtitle })

test('remote pushes, installs, deletes, messages and network commands are external', () => {
  assert.equal(externalAction(card('git push origin main'))?.kind, 'push')
  assert.equal(externalAction(card('npm publish --access public'))?.kind, 'push')
  assert.equal(externalAction(card('npm install left-pad'))?.kind, 'install')
  assert.equal(externalAction(card('pip install -e .'))?.kind, 'install')
  assert.equal(externalAction(card('rm -rf build'))?.kind, 'delete')
  assert.equal(externalAction(card('find . -name "*.tmp" -delete'))?.kind, 'delete')
  assert.equal(externalAction(card('curl https://example.com'))?.kind, 'network')
  assert.equal(externalAction(card('ssh host uptime'))?.kind, 'network')
  assert.equal(externalAction(card('git fetch origin'))?.kind, 'network')
  assert.equal(externalAction(card('gh pr comment 1 --body ok'))?.kind, 'message')
  assert.equal(externalAction(card('sudo rm -rf /tmp/x'))?.kind, 'privilege')
})

test('local test and build commands stay inside the member permission', () => {
  assert.equal(externalAction(card('npm test')), null)
  assert.equal(externalAction(card('npm run build')), null)
  assert.equal(externalAction(card('node --test')), null)
  assert.equal(externalAction({ tool: 'Write', action: 'write', subtitle: 'src/a.js' }), null)
})

test('a network tool without a command is still classified', () => {
  assert.equal(externalAction({ tool: 'WebFetch', subtitle: '' })?.kind, 'network')
})

test('only pending approvals need attention', () => {
  const room = {
    approvals: [
      { id: 'a', state: 'pending' },
      { id: 'b', state: 'allowed' },
      { id: 'c', state: 'expired' },
    ],
  }
  assert.deepEqual(pendingApprovals(room).map(item => item.id), ['a'])
  assert.deepEqual(pendingApprovals({}), [])
})

test('common option and wrapper forms are still external', () => {
  assert.equal(externalAction(card('git -C /repo push origin main'))?.kind, 'push')
  assert.equal(externalAction(card('npm --prefix . install'))?.kind, 'install')
  assert.equal(externalAction(card('env rm -rf build'))?.kind, 'delete')
  assert.equal(externalAction(card('cmd /c del build\\x.js'))?.kind, 'delete')
  assert.equal(externalAction(card('git -C /repo fetch'))?.kind, 'network')
})

test('the full command survives truncation for approval review', async () => {
  const long = `${'echo '.repeat(80)} && git push origin main`
  const action = externalAction(card(long))
  assert.equal(action.kind, 'push')
  assert.match(action.command, /git push origin main/)
  const review = reviewExternalAction({
    approval: { memberId: 'worker', kind: action.kind, summary: action.summary, command: action.command },
    room: { members: [{ id: 'worker', role: 'worker' }], constraints: [] },
  })
  assert.equal(review.decision, 'review')
})
