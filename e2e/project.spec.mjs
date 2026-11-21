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

const phase = ({ id, name, goal, state, sourceRoomId, nextRoomId }) => ({
  id,
  kind: 'room',
  roomType: 'studio',
  name,
  goal,
  state,
  live: true,
  demo: false,
  members,
  messages: [],
  stages: [{ title: '实现', kind: 'deliverable', state: state === 'complete' ? 'passed' : 'active', acceptance: 'npm test' }],
  sourceRoomId,
  nextRoomId,
  modeCapabilities: { stages: true },
  capabilities: {},
  independenceLabel: '独立复核',
  delivery: state === 'complete' ? { changedFiles: ['src/phase.js'] } : null,
})

test('a three-phase project reads as one trail and opens a phase', async ({ page, request }) => {
  const base = await (await request.get('/api/state')).json()
  const rooms = [
    { ...phase({ id: 'phase-1', name: '长期项目', goal: '把长期目标拆成三个可交付阶段', state: 'complete', nextRoomId: 'phase-2' }), project: { northStar: '把长期目标做成可交付项目' }, phase: { name: '阶段一', index: 1 } },
    { ...phase({ id: 'phase-2', name: '第二阶段', goal: '补上真实数据', state: 'complete', sourceRoomId: 'phase-1', nextRoomId: 'phase-3' }), phase: { name: '阶段二', index: 2 } },
    { ...phase({ id: 'phase-3', name: '第三阶段', goal: '放到真实房间', state: 'active', sourceRoomId: 'phase-2' }), phase: { name: '阶段三', index: 3 } },
  ]
  await page.route('**/api/state', route => route.fulfill({ json: { ...base, rooms } }))
  await page.goto('/')

  await expect(page.getByRole('button', { name: '项目轨迹' })).toBeVisible()
  await page.getByRole('button', { name: '项目轨迹' }).click()
  await expect(page.getByRole('heading', { name: '长期项目' })).toBeVisible()
  await expect(page.locator('.crew-project-phase')).toHaveCount(3)
  await expect(page.getByText('3 个阶段 · 当前第 3 阶段')).toBeVisible()
  await expect(page.getByText('把长期目标做成可交付项目')).toBeVisible()
  await expect(page.getByText('阶段三').first()).toBeVisible()

  await page.getByRole('button', { name: '打开当前阶段' }).click()
  await expect(page.getByRole('button', { name: '项目轨迹' })).toBeVisible()
})

test('a delivered project opens the next phase from the trail', async ({ page, request }) => {
  const base = await (await request.get('/api/state')).json()
  let rooms = [
    { ...phase({ id: 'phase-1', name: '长期项目', goal: '把长期目标拆成三个可交付阶段', state: 'complete', nextRoomId: 'phase-2' }), project: { northStar: '把长期目标做成可交付项目' }, phase: { name: '阶段一', index: 1 } },
    { ...phase({ id: 'phase-2', name: '第二阶段', goal: '补上真实数据', state: 'complete', sourceRoomId: 'phase-1', nextRoomId: 'phase-3' }), phase: { name: '阶段二', index: 2 } },
    { ...phase({ id: 'phase-3', name: '第三阶段', goal: '放到真实房间', state: 'complete', sourceRoomId: 'phase-2' }), phase: { name: '阶段三', index: 3 } },
  ]
  const next = {
    ...phase({
      id: 'phase-4',
      name: '第四阶段',
      goal: '接上真实用户',
      state: 'active',
      sourceRoomId: 'phase-3',
    }),
    phase: { name: '接上真实用户', index: 4 },
  }
  await page.route('**/api/state', route => route.fulfill({ json: { ...base, rooms } }))
  await page.route('**/api/rooms/phase-3/followup', async route => {
    const body = route.request().postDataJSON()
    expect(body.text).toBe('接上真实用户')
    expect(body.verify).toBe('test')
    expect(body.acceptance).toBe('npm test')
    rooms = rooms.map(room => room.id === 'phase-3' ? { ...room, nextRoomId: 'phase-4' } : room).concat(next)
    await route.fulfill({ json: { room: next } })
  })
  await page.goto('/')

  await page.getByRole('button', { name: '项目轨迹' }).click()
  await expect(page.getByLabel('下一阶段要做什么？')).toBeVisible()
  await page.getByLabel('下一阶段要做什么？').fill('接上真实用户')
  await page.getByLabel('验收命令（可不填）').fill('npm test')
  await page.getByRole('button', { name: '开下一阶段' }).click()
  await expect(page.getByText('4 个阶段 · 当前第 4 阶段')).toBeVisible()
  await expect(page.getByRole('button', { name: '打开当前阶段' })).toBeVisible()
})
