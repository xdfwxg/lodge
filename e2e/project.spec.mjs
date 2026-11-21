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
    phase({ id: 'phase-1', name: '长期项目', goal: '把长期目标拆成三个可交付阶段', state: 'complete', nextRoomId: 'phase-2' }),
    phase({ id: 'phase-2', name: '第二阶段', goal: '补上真实数据', state: 'complete', sourceRoomId: 'phase-1', nextRoomId: 'phase-3' }),
    phase({ id: 'phase-3', name: '第三阶段', goal: '放到真实房间', state: 'active', sourceRoomId: 'phase-2' }),
  ]
  await page.route('**/api/state', route => route.fulfill({ json: { ...base, rooms } }))
  await page.goto('/')

  await expect(page.getByRole('button', { name: '项目轨迹' })).toBeVisible()
  await page.getByRole('button', { name: '项目轨迹' }).click()
  await expect(page.getByRole('heading', { name: '长期项目' })).toBeVisible()
  await expect(page.locator('.crew-project-phase')).toHaveCount(3)
  await expect(page.getByText('3 个阶段 · 当前第 3 阶段')).toBeVisible()
  await expect(page.getByText('把长期目标拆成三个可交付阶段').first()).toBeVisible()

  await page.getByRole('button', { name: '打开当前阶段' }).click()
  await expect(page.getByRole('button', { name: '项目轨迹' })).toBeVisible()
})
