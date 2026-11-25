import { expect, test } from '@playwright/test'

const member = (id, name, role, roleKind) => ({
  id,
  name,
  role,
  roleKind,
  permissions: {},
  body: { kind: 'base', ref: `bot-${id}`, name },
})

const members = [
  member('planner', '规划师', 'lead', 'planner'),
  member('worker', '执行官', 'worker', 'executor'),
  member('verifier', '验收员', 'verifier', 'verifier'),
]

const completedRound = {
  id: 'round-1',
  roomId: 'room-1',
  projectId: 'project-1',
  ordinal: 1,
  status: 'completed',
  name: '先做一个原型',
  goal: '先做一个原型',
  startedAt: Date.now() - 60_000,
  completedAt: Date.now() - 30_000,
  completedCommit: 'abc12345',
}

const studio = over => ({
  id: 'room-1',
  kind: 'room',
  roomType: 'studio',
  name: '长期工作间',
  goal: '先做一个原型',
  state: 'idle',
  live: true,
  demo: false,
  defaultProjectId: 'project-1',
  workRound: completedRound,
  members,
  messages: [],
  stages: [{ title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'npm test' }],
  modeCapabilities: { stages: true },
  capabilities: {},
  independenceLabel: '独立复核',
  delivery: { changedFiles: ['src/a.js'] },
  ...over,
})


const openHistory = async page => {
  await page.getByRole('button', { name: /^管理 / }).first().click()
  await page.getByRole('menuitem', { name: '历史' }).click()
}

test('an old round opens as a read-only record, not the current round', async ({ page, request }) => {
  const base = await (await request.get('/api/state')).json()
  const currentRound = {
    ...completedRound,
    id: 'round-2',
    ordinal: 2,
    status: 'active',
    name: '修登录超时',
    goal: '修登录超时',
    completedAt: null,
    completedCommit: null,
  }
  const oldMessage = {
    id: 'message-old',
    roomId: 'room-1',
    kind: 'chat',
    authorId: 'planner',
    text: '第一轮做完了，原型能跑。',
    ts: Date.now() - 45_000,
    seq: 1,
  }
  const state = {
    ...base,
    rooms: [studio({
      state: 'active',
      goal: '修登录超时',
      workRound: currentRound,
      rounds: [completedRound, currentRound],
      stages: [{ title: '修登录超时', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
      delivery: null,
    })],
    projects: [],
  }
  const historyRoom = studio({
    state: 'idle',
    goal: '先做一个原型',
    workRound: completedRound,
    messages: [oldMessage],
    delivery: { changedFiles: ['src/a.js'] },
  })
  await page.route('**/api/state', route => route.fulfill({ json: state }))
  await page.route('**/api/rooms/room-1/rounds/round-1', route => route.fulfill({
    json: { round: completedRound, room: historyRoom, messages: [oldMessage] },
  }))
  await page.goto('/')

  await page.getByRole('button', { name: /长期工作间/ }).first().click()
  await openHistory(page)
  await page.getByRole('button', { name: /先做一个原型/ }).click()

  await expect(page.getByText('旧轮只能查看；要接着做，回到工作室开新一轮。')).toBeVisible()
  await expect(page.getByText('第一轮做完了，原型能跑。')).toBeVisible()

  await page.getByRole('button', { name: '← 回到工作室' }).click()
  await expect(page.getByRole('heading', { name: '历史' })).toHaveCount(0)
})

test('a studio without a project can still open its old rounds', async ({ page, request }) => {
  const base = await (await request.get('/api/state')).json()
  const currentRound = {
    ...completedRound,
    id: 'round-2',
    ordinal: 2,
    status: 'active',
    name: '修登录超时',
    goal: '修登录超时',
    completedAt: null,
    completedCommit: null,
  }
  const state = {
    ...base,
    rooms: [studio({
      state: 'active',
      goal: '修登录超时',
      workRound: currentRound,
      rounds: [completedRound, currentRound],
      defaultProjectId: null,
      stages: [{ title: '修登录超时', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
      delivery: null,
    })],
    projects: [],
  }
  const historyRoom = studio({ state: 'idle', goal: '先做一个原型', workRound: completedRound, messages: [] })
  await page.route('**/api/state', route => route.fulfill({ json: state }))
  await page.route('**/api/rooms/room-1/rounds/round-1', route => route.fulfill({
    json: { round: completedRound, room: historyRoom, messages: [] },
  }))
  await page.goto('/')

  await page.getByRole('button', { name: /长期工作间/ }).first().click()
  await openHistory(page)
  await expect(page.getByText('2 轮')).toBeVisible()
  await page.getByRole('button', { name: /先做一个原型/ }).click()
  await expect(page.getByText('旧轮只能查看；要接着做，回到工作室开新一轮。')).toBeVisible()
})

test('history opens for a room that is not the currently selected one', async ({ page, request }) => {
  const base = await (await request.get('/api/state')).json()
  const state = {
    ...base,
    rooms: [
      studio({ id: 'room-1', name: '长期工作间', rounds: [completedRound] }),
      studio({ id: 'room-2', name: '第二间工作间', rounds: [completedRound] }),
    ],
    projects: [],
  }
  await page.route('**/api/state', route => route.fulfill({ json: state }))
  await page.goto('/')
  await page.getByRole('button', { name: /^长期工作间/ }).first().click()
  const row = page.locator('.crew-side-row', { hasText: '第二间工作间' }).first()
  await row.hover()
  await row.getByRole('button', { name: /^管理 / }).click()
  await page.getByRole('menuitem', { name: '历史' }).click()
  await expect(page.getByText('1 轮')).toBeVisible()
  await expect(page.getByRole('heading', { name: '历史' })).toBeVisible()
})
