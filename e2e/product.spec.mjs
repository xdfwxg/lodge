import { expect, test } from '@playwright/test'

test('onboarding, focused dialog, sample room, goal panel and archive restore', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Lodge' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开工' })).toBeDisabled()
  await page.getByLabel('你想让房间做什么？').fill('把启动说明补成新人能照着跑的一页')
  await expect(page.getByRole('button', { name: '开工' })).toBeEnabled()

  await page.getByRole('button', { name: '更多设置' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', '关闭')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.reload()
  await expect(page.getByText('示例：发布前检查清单').first()).toBeVisible()

  await page.getByRole('button', { name: /打开目标/ }).click()
  await page.getByRole('button', { name: '目标和检查' }).click()
  await expect(page.getByText('目标', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('检查', { exact: true }).first()).toBeVisible()
  await page.keyboard.press('Escape')

  const state = await (await request.get('/api/state')).json()
  const id = state.rooms.find(room => room.demo === true)?.id
  expect(id).toBeTruthy()
  expect((await request.post(`/api/rooms/${id}/archive`, { data: { archived: true } })).ok()).toBe(true)
  await page.reload()
  await expect(page.getByText('已归档的房间')).toBeVisible()
  await page.getByRole('button', { name: /恢复「/ }).click()
  await expect(page.getByText('示例：发布前检查清单').first()).toBeVisible()
})

test('a narrow dark window still renders the room without horizontal overflow', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '示例：发布前检查清单' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
