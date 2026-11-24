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

const project = over => ({
  id: 'project-1',
  name: '长期项目',
  northStar: '把长期目标做成可交付项目',
  rounds: [completedRound],
  ...over,
})

const openHistory = async page => {
  await page.getByRole('button', { name: /^管理 / }).first().click()
  await page.getByRole('menuitem', { name: '历史' }).click()
}

const expectHistory = async page => {
  await page.getByRole('button', { name: /^管理 / }).first().click()
  await expect(page.getByRole('menuitem', { name: '历史' })).toBeVisible()
  await page.keyboard.press('Escape')
}

const openProject = async page => {
  await openHistory(page)
  await page.getByRole('button', { name: '项目' }).click()
}

test('a project lists its rounds and opens the studio that owns them', async ({ page, request }) => {
  const base = await (await request.get('/api/state')).json()
  const state = {
    ...base,
    rooms: [studio()],
    projects: [project()],
  }
  await page.route('**/api/state', route => route.fulfill({ json: state }))
  await page.goto('/')

  await page.getByRole('button', { name: /长期工作间/ }).first().click()
  await openProject(page)
  await expect(page.getByRole('heading', { name: '长期项目' })).toBeVisible()
  await expect(page.getByText('1 轮 · 已交付')).toBeVisible()
  await expect(page.getByText('先做一个原型').first()).toBeVisible()

  await page.getByRole('button', { name: '打开这一轮的工作室' }).click()
  await expectHistory(page)
})

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
      stages: [{ title: '修登录超时', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
      delivery: null,
    })],
    projects: [project({ rounds: [completedRound, currentRound] })],
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
  await openProject(page)
  await page.getByRole('button', { name: /先做一个原型/ }).click()

  await expect(page.getByText('旧轮只能查看；要接着做，回到工作室开新一轮。')).toBeVisible()
  await expect(page.getByText('第一轮做完了，原型能跑。')).toBeVisible()
  await expect(page.getByRole('button', { name: '项目' })).toHaveCount(0)

  await page.getByRole('button', { name: '← 回到工作室' }).click()
  await expectHistory(page)
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

test('a completed project starts the next round in the same studio', async ({ page, request }) => {
  const base = await (await request.get('/api/state')).json()
  let state = {
    ...base,
    rooms: [studio()],
    projects: [project()],
  }
  const nextRound = {
    ...completedRound,
    id: 'round-2',
    ordinal: 2,
    status: 'active',
    name: '修登录超时',
    goal: '修登录超时',
    completedAt: null,
    completedCommit: null,
  }
  const activeRoom = studio({
    state: 'active',
    goal: '修登录超时',
    workRound: nextRound,
    stages: [{ title: '修登录超时', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
    delivery: null,
  })
  await page.route('**/api/state', route => route.fulfill({ json: state }))
  await page.route('**/api/rooms/room-1/rounds', async route => {
    const body = route.request().postDataJSON()
    expect(body.text).toBe('修登录超时')
    expect(body.projectId).toBe('project-1')
    expect(body.verify).toBeUndefined()
    expect(body.acceptance).toBeUndefined()
    state = {
      ...state,
      rooms: [activeRoom],
      projects: [project({ rounds: [completedRound, nextRound] })],
    }
    await route.fulfill({ json: { room: activeRoom } })
  })
  await page.goto('/')

  await page.getByRole('button', { name: /长期工作间/ }).first().click()
  await openProject(page)
  await page.getByLabel('下一轮要做什么？').fill('修登录超时')
  await page.getByRole('button', { name: '开下一轮' }).click()

  await expect(page.getByText('2 轮 · 进行中')).toBeVisible()
  await expect(page.getByText('修登录超时').first()).toBeVisible()
})

test('a project asks only for the next goal, not a second decision', async ({ page, request }) => {
  const base = await (await request.get('/api/state')).json()
  let state = {
    ...base,
    rooms: [studio({ repoPath: '/tmp/room-1' })],
    projects: [project()],
  }
  const nextRound = {
    ...completedRound,
    id: 'round-2',
    ordinal: 2,
    status: 'active',
    name: '修登录超时',
    goal: '修登录超时',
    completedAt: null,
    completedCommit: null,
  }
  let recommended = false
  await page.route('**/api/state', route => route.fulfill({ json: state }))
  await page.route('**/api/roster/recommend', route => {
    recommended = true
    return route.fulfill({ json: { proposal: {} } })
  })
  await page.route('**/api/rooms/room-1/rounds', async route => {
    const body = route.request().postDataJSON()
    expect(body.text).toBe('修登录超时')
    expect(body.plan).toBeUndefined()
    expect(body.verify).toBeUndefined()
    expect(body.acceptance).toBeUndefined()
    state = {
      ...state,
      rooms: [studio({
        state: 'active',
        goal: '修登录超时',
        workRound: nextRound,
        stages: [{ title: '修登录超时', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
        delivery: null,
      })],
      projects: [project({ rounds: [completedRound, nextRound] })],
    }
    await route.fulfill({ json: { room: state.rooms[0] } })
  })
  await page.goto('/')

  await page.getByRole('button', { name: /长期工作间/ }).first().click()
  await openProject(page)
  await expect(page.getByLabel('验收命令（可不填）')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '先出方案' })).toHaveCount(0)
  await expect(page.getByText('开工前决定')).toHaveCount(0)

  await page.getByLabel('下一轮要做什么？').fill('修登录超时')
  await page.getByRole('button', { name: '开下一轮' }).click()

  await expect(page.getByText('2 轮 · 进行中')).toBeVisible()
  expect(recommended).toBe(false)
})
