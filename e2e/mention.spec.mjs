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

test('a picked member travels as an id with the message', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')

  const composer = page.getByRole('combobox', { name: '房间消息' })
  await composer.fill('@')
  await page.locator('.crew-mentions').getByRole('option').first().click()
  await composer.press('End')
  await composer.pressSequentially(' 看下这条')
  const posted = page.waitForRequest(req => req.url().includes('/messages') && req.method() === 'POST')
  await composer.press('Enter')
  const body = JSON.parse((await posted).postData() ?? '{}')
  expect(body.text).toContain('@')
  expect(body.mentions).toHaveLength(1)
  expect(typeof body.mentions[0]).toBe('string')
})
