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
  await page.getByRole('button', { name: '项目' }).click()
  await expect(page.getByRole('heading', { name: '长期项目' })).toBeVisible()
  await expect(page.getByText('1 轮 · 已交付')).toBeVisible()
  await expect(page.getByText('先做一个原型').first()).toBeVisible()

  await page.getByRole('button', { name: '打开这一轮的工作室' }).click()
  await expect(page.getByRole('button', { name: '项目' })).toBeVisible()
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
  await page.route('**/api/rooms/room-1/followup', async route => {
    const body = route.request().postDataJSON()
    expect(body.text).toBe('修登录超时')
    expect(body.projectId).toBe('project-1')
    expect(body.verify).toBe('test')
    expect(body.acceptance).toBe('npm test')
    state = {
      ...state,
      rooms: [activeRoom],
      projects: [project({ rounds: [completedRound, nextRound] })],
    }
    await route.fulfill({ json: { room: activeRoom } })
  })
  await page.goto('/')

  await page.getByRole('button', { name: /长期工作间/ }).first().click()
  await page.getByRole('button', { name: '项目' }).click()
  await page.getByLabel('下一轮要做什么？').fill('修登录超时')
  await page.getByLabel('验收命令（可不填）').fill('npm test')
  await page.getByRole('button', { name: '开下一轮' }).click()

  await expect(page.getByText('2 轮 · 进行中')).toBeVisible()
  await expect(page.getByText('修登录超时').first()).toBeVisible()
})
