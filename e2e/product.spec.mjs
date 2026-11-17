import { expect, test } from '@playwright/test'

test('onboarding, focused dialog, sample room, goal panel and archive restore', async ({ page, request }) => {
  // 前面的用例可能留下了示例房；先归档，保证从“新房间”开始。
  const existing = await (await request.get('/api/state')).json()
  for (const room of existing.rooms.filter(item => !item.archivedAt)) {
    await request.post(`/api/rooms/${room.id}/archive`, { data: { archived: true } })
  }
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '新房间' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开工', exact: true })).toBeDisabled()
  await page.getByLabel('要做什么？').fill('把启动说明补成新人能照着跑的一页')
  // 测试环境故意不接基座；没有可用模型时开工必须继续禁用，而不是等服务端拒绝。
  await expect(page.getByRole('button', { name: '开工', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: '开工作室' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', '关闭')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.reload()
  await expect(page.getByText('示例：发布前检查清单').first()).toBeVisible()

  await page.locator('.bt-goal-closed').click()
  await page.getByRole('button', { name: '目标和检查' }).click()
  await expect(page.getByText('目标', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('检查', { exact: true }).first()).toBeVisible()
  await page.keyboard.press('Escape')

  const state = await (await request.get('/api/state')).json()
  const id = state.rooms.find(room => room.demo === true)?.id
  expect(id).toBeTruthy()
  expect((await request.post(`/api/rooms/${id}/archive`, { data: { archived: true } })).ok()).toBe(true)
  await page.reload()
  // 行内的“⋯”只在悬停或键盘聚焦时出现；先让行进入悬停态。
  await page.getByRole('button', { name: '示例：发布前检查清单，已归档' }).hover()
  await page.getByRole('button', { name: '管理 示例：发布前检查清单' }).click()
  await page.getByRole('menuitem', { name: '取消归档' }).click()
  await expect(page.getByText('示例：发布前检查清单').first()).toBeVisible()
})

test('opening a detail keeps the reading position', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')

  const scroller = page.locator('.dsb-scroll')
  const summary = page.locator('.studio-delivery-details > summary')
  await expect(summary).toBeVisible()
  const before = await summary.boundingBox()
  const scrollBefore = await scroller.evaluate(node => node.scrollTop)
  await summary.click()
  const after = await summary.boundingBox()
  const scrollAfter = await scroller.evaluate(node => node.scrollTop)
  expect(scrollAfter).toBe(scrollBefore)
  expect(Math.abs(after.y - before.y)).toBeLessThan(1)
})

test('expanding the worklog keeps the reading position', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')

  const scroller = page.locator('.dsb-scroll')
  const summary = page.locator('.studio-worklog > summary')
  await summary.scrollIntoViewIfNeeded()
  const before = await summary.boundingBox()
  const scrollBefore = await scroller.evaluate(node => node.scrollTop)
  await summary.click()
  const after = await summary.boundingBox()
  const scrollAfter = await scroller.evaluate(node => node.scrollTop)
  expect(scrollAfter).toBe(scrollBefore)
  expect(Math.abs(after.y - before.y)).toBeLessThan(1)
})

test('expanding new-room options keeps the dialog anchored', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新建房间' }).click()
  await page.getByRole('button', { name: '工作室', exact: true }).click()

  const dialog = page.locator('.crew-dialog')
  const summary = page.locator('.crew-new-advanced > summary')
  await summary.scrollIntoViewIfNeeded()
  const summaryBefore = await summary.boundingBox()
  const dialogBefore = await dialog.boundingBox()
  await summary.click()
  const summaryAfter = await summary.boundingBox()
  const dialogAfter = await dialog.boundingBox()
  expect(dialogAfter.y).toBeCloseTo(dialogBefore.y, 1)
  expect(Math.abs(summaryAfter.y - summaryBefore.y)).toBeLessThan(1)
})

test('a narrow dark window still renders the room without horizontal overflow', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '发布前检查清单' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
