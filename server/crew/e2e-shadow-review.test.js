import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAdvisorServer } from '../advisor-service.mjs'
import { createAdvisorClient } from './advisor.js'
import { createCrewPorts } from './crew-ports.js'
import { createRealRoom } from './rooms/create/create.js'
import { createReviewCoordinator } from './rooms/studio/review.js'
import { createStore } from './store.js'

const temp = prefix => mkdtempSync(join(tmpdir(), prefix))

const gitRepo = () => {
  const repo = temp('lodge-shadow-repo-')
  execFileSync('git', ['init', '-q'], { cwd: repo })
  writeFileSync(join(repo, 'README.md'), '# shadow\n')
  execFileSync('git', ['add', 'README.md'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=Lodge', '-c', 'user.email=lodge@localhost', 'commit', '-q', '-m', 'init'], { cwd: repo })
  return repo
}

const fakeEngine = () => ({
  capabilities: () => ({ provisioning: true, mentions: true, mcp: false }),
  createMemberBot: async ({ name }) => ({ id: `member-${name}`, name, engine: 'fake', model: 'fake' }),
  createRoom: async ({ name }) => ({ id: `room-${name}`, sessionRef: `thread-${name}` }),
})

const fakeLive = () => ({
  attach: async () => {},
  startStage: async () => {},
  sendToMember: async () => ({ messageId: null }),
  busyReview: () => false,
  reworkStage: async () => {},
  isAttached: () => true,
  cancel: async () => ({ cancelled: false }),
})

test('a new room with shadow review records advice outside the verifier prompt', async () => {
  const dataDir = temp('lodge-shadow-data-')
  const repo = gitRepo()
  const store = createStore({ dataDir })
  const advisorServer = createAdvisorServer()
  await new Promise(resolve => advisorServer.listen(0, '127.0.0.1', resolve))
  try {
    const port = advisorServer.address().port
    const advisor = createAdvisorClient({ url: `http://127.0.0.1:${port}/evaluate`, timeoutMs: 2000 })
    const ports = { ...createCrewPorts(), advisor }
    const created = await createRealRoom({
      store,
      engine: fakeEngine(),
      live: fakeLive(),
      emit: () => {},
      ports,
      body: {
        goal: '验证影子评审',
        verify: 'test',
        acceptance: 'npm test',
        shadowReview: true,
        repoPath: repo,
        members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
        plan: {
          done: ['产物就绪'],
          stages: [{ title: '导出', kind: 'deliverable', acceptance: 'manual' }],
        },
      },
    })
    assert.equal(created.ok, true)
    const room = created.body.room
    assert.equal(room.shadowReview, true)
    const index = room.stages.findIndex(stage => stage.manual === true)
    assert.ok(index >= 0)
    assert.equal(room.stages[index].state, 'active')
    const evidence = store.appendMessage(room.id, {
      kind: 'evidence',
      authorId: 'executor',
      text: '产物已就绪',
      meta: { kind: 'manual', stage: index, simulated: false },
    })

    assert.equal(room.advisorConsent.host, `127.0.0.1:${port}`)
    const sent = []
    const review = createReviewCoordinator({
      store,
      roomId: room.id,
      emit: () => {},
      sendToMember: async (memberId, prompt) => {
        sent.push({ memberId, prompt })
        return { messageId: null }
      },
      advisor,
    })
    await review.request(index)
    await review.shadowSettled()

    assert.equal(sent.length, 1)
    assert.doesNotMatch(sent[0].prompt, /外部意见|评估建议|验收命令退出码 无/)
    const notice = store.readMessages(room.id).find(message => message.meta?.advisorNotice === true)
    assert.ok(notice)
    assert.match(notice.text, /127\.0\.0\.1/)
    assert.match(notice.text, /证据和 diff/)
    const advice = store.readRoom(room.id).advisorShadow?.[index]
    assert.ok(advice)
    assert.equal(advice.evidenceId, evidence.id)
    assert.equal('score' in advice.advice[0], false)
    assert.ok((advice.advice[0].reasons ?? []).length > 0 || (advice.advice[0].risks ?? []).length > 0)
    assert.equal(store.readMessages(room.id).some(message => message.kind === 'advisor_advice'), false)
  } finally {
    await new Promise(resolve => advisorServer.close(resolve))
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})
