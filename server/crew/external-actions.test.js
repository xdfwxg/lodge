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

test('deletes inside the work copy or temp do not need approval', () => {
  const scope = { cwd: '/work/worker', writable: ['/work/worker', '/tmp'] }
  assert.equal(externalAction(card('rm -rf .tmp'), scope), null)
  assert.equal(externalAction(card('cd /work/worker && rm -rf build'), scope), null)
  assert.equal(externalAction(card('find . -name "*.tmp" -delete'), scope), null)
  assert.equal(externalAction(card('cd /work/worker && CLEAN=$(mktemp -d) && tar -x -C "$CLEAN" && rm -rf "$CLEAN"'), scope), null)
})

test('deletes outside the writable scope keep the approval', () => {
  const scope = { cwd: '/work/worker', writable: ['/work/worker', '/tmp'] }
  assert.equal(externalAction(card('rm -rf /etc'), scope)?.kind, 'delete')
  assert.equal(externalAction(card('rm -rf ../other'), scope)?.kind, 'delete')
  assert.equal(externalAction(card('rm -rf "$HOME"'), scope)?.kind, 'delete')
  // 变量不是本命令里 mktemp 出来的：不猜，仍停下来问。
  assert.equal(externalAction(card('rm -rf "$CLEAN"'), scope)?.kind, 'delete')
  assert.equal(externalAction(card('cd /work/worker && rm -rf /tmp/x'), {
    cwd: '/work/worker',
    writable: ['/work/worker'],
  })?.kind, 'delete')
})

test('a tilde delete is the home directory, not a folder named ~ in the work copy', () => {
  const scope = { cwd: '/work/worker', writable: ['/work/worker', '/tmp'] }
  assert.equal(externalAction(card('rm -rf ~'), scope)?.kind, 'delete')
  assert.equal(externalAction(card('rm -rf ~/Downloads'), scope)?.kind, 'delete')
  assert.equal(externalAction(card('cd /work/worker && rm -rf ~/projects'), scope)?.kind, 'delete')
})

test('multiple lines are separate commands and quoting inside a line does not merge them', () => {
  const scope = { cwd: '/work/worker', writable: ['/work/worker', '/tmp'] }
  // 嵌入式 JS 里有 | 和 ;：不能因此把后面的 rm 裹进一段假引号里。
  const clean = [
    'CLEAN=$(mktemp -d)',
    'cp -R README.md "$CLEAN"/',
    `node -e "console.log('a|b;c')"`,
    'rm -rf "$CLEAN"',
  ].join('\n')
  assert.equal(externalAction(card(clean), scope), null)
  const outside = [
    `node -e "console.log('a|b;c')"`,
    'rm -rf /',
  ].join('\n')
  assert.equal(externalAction(card(outside), scope)?.kind, 'delete')
})

test('deletes that follow a separator or a paren are still seen as commands', () => {
  // 真房教训（hello-proof 两次停在这）：命令里有 for 循环、mktemp 和括号子 shell 时，
  // 引号切段会把后面连成一大段，`; rm` / `); rm` 前面不是包装命令而是分隔符——
  // 以前这里直接跳过，整条命令就被当成外部删除，白停一个人。
  const scope = { cwd: '/work/worker', writable: ['/work/worker', '/tmp'] }
  const proof = [
    'cd /work/worker && mkdir -p tmpdir && (cd tmpdir && node ../tools/check.mjs; echo "sub exit=$?"); rmdir tmpdir',
    'd=$(mktemp -d); cp -R hello.txt tools "$d"/; (cd "$d" && node tools/check.mjs >/dev/null; echo "good exit=$?"; rm hello.txt; node tools/check.mjs >/dev/null 2>&1); rm -rf "$d"',
    'for c in "node a.mjs" "test -f hello.txt"; do (cd /tmp/x && sh -c "$c" >/dev/null 2>&1; echo "exit=$?"); done',
  ]
  for (const command of proof) assert.equal(externalAction(card(command), scope), null, command.slice(0, 60))
  // 但 `; rm` 指向外面时仍然要停。
  assert.equal(externalAction(card('echo hi; rm -rf /etc'), scope)?.kind, 'delete')
  assert.equal(externalAction(card('(rm -rf ../other)'), scope)?.kind, 'delete')
  // `echo rm` 是参数，不是命令。
  assert.equal(externalAction(card('echo rm -rf /etc'), scope), null)
})

test('a local rsync copy is local, a remote one is not', () => {
  const scope = { cwd: '/work/worker', writable: ['/work/worker', '/tmp'] }
  assert.equal(externalAction(card('rsync -a --exclude .git ./ /tmp/cleanproof/'), scope), null)
  assert.equal(externalAction(card('D=$(mktemp -d); rsync -a ./ "$D"/'), scope), null)
  assert.equal(externalAction(card('rsync -az ./ build@example.com:/srv/app'), scope)?.kind, 'network')
  assert.equal(externalAction(card('rsync -a -e ssh ./ host:/srv'), scope)?.kind, 'network')
  // 别的网络动作不能被本地 rsync 带过去。
  assert.equal(externalAction(card('rsync -a ./ /tmp/x && curl https://example.com'), scope)?.kind, 'network')
})

test('an internal delete does not hide another external action', () => {
  const scope = { cwd: '/work/worker', writable: ['/work/worker', '/tmp'] }
  assert.equal(externalAction(card('rm -rf .tmp && git push origin main'), scope)?.kind, 'push')
  assert.equal(externalAction(card('rm -rf .tmp && npm install left-pad'), scope)?.kind, 'install')
})

test('writing text that mentions an install command is not an install', () => {
  assert.equal(externalAction({
    tool: 'Edit',
    action: 'write',
    subtitle: '{"file_path":"README.md","new_string":"在项目根目录执行 npm install。"}',
  }), null)
  assert.equal(externalAction({ tool: 'Write', action: 'write', subtitle: 'npm install left-pad' }), null)
})

test('a network tool without a command is still classified', () => {
  assert.equal(externalAction({ tool: 'WebFetch', subtitle: '' })?.kind, 'network')
})

test('the built-in gate tool is not an external action', () => {
  assert.equal(externalAction({ tool: 'lodge_gate:submit_verdict', action: 'gate', subtitle: '' }), null)
  assert.equal(externalAction({ tool: 'mcp__lodge_gate__submit_decision', action: 'gate', subtitle: '' }), null)
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

test('tool descriptions never turn an external tool into a local action', () => {
  assert.equal(externalAction({ tool: 'mcp__github__create_issue', action: 'exec', subtitle: 'Create issue in repo' })?.kind, 'network')
  assert.equal(externalAction({ tool: 'mcp__github__list_issues', action: 'exec', subtitle: 'List issues' })?.kind, 'network')
  assert.equal(externalAction({ tool: 'WebFetch', action: 'exec', subtitle: 'https://example.com' })?.kind, 'network')
  assert.equal(externalAction(card('ls -la')), null)
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

test('an approval names the thing being changed, not the whole command', () => {
  const target = command => externalAction(card(command))?.target
  assert.equal(target('python3 -m pip install --quiet --user opencv-python-headless 2>&1 | tail -3; python3 -c " import cv2"'), 'opencv-python-headless')
  assert.equal(target('npm install left-pad'), 'left-pad')
  assert.equal(target('pip install -e .'), '当前项目')
  assert.equal(target('git push origin main'), 'main')
  assert.equal(target('rm -rf build'), 'build')
  assert.equal(target('curl https://example.com/x'), 'example.com')
  assert.equal(target('ssh host uptime'), 'host')
  assert.equal(target('git fetch origin'), '远端')
  assert.equal(target('sudo rm -rf /tmp/x'), '系统命令')
  assert.equal(target('gh pr comment 1 --body ok'), '房间外')
  assert.equal(externalAction({ tool: 'WebFetch', subtitle: 'https://docs.example.com/a' })?.target, 'docs.example.com')
})
