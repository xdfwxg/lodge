import { expect, test } from '@playwright/test'

test('the mention menu stays a compact people picker', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')

  await page.getByRole('combobox', { name: '房间消息' }).fill('@')
  const menu = page.locator('.crew-mentions')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('option')).toHaveCount(4)
  await expect(menu).toContainText('所有人')
  await expect(menu).toContainText('每位成员')
  const box = await menu.boundingBox()
  expect(box.width).toBeLessThanOrEqual(322)
})
