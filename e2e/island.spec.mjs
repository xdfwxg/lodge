import { expect, test } from '@playwright/test'

test('the island and the room list agree on concluded and delivered rooms', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  expect((await request.post('/api/rooms/sample', { data: { kind: 'chat' } })).ok()).toBe(true)
  await page.goto('/')

  const chatRow = page.locator('.crew-side-room[title^="示例：把「朏朏住在灵动岛上」"]')
  const studioRow = page.locator('.crew-side-room[title^="示例：把《羽仙记》的结尾改得更看得见"]')
  await expect(chatRow).toBeVisible()
  await expect(studioRow).toBeVisible()

  await chatRow.click()
  await expect(page.locator('.bt-goal-mini-title')).toHaveText('聊到这儿了')
  await expect(page.locator('.bt-goal-closed')).toHaveAttribute('aria-label', /聊到这儿了/)

  await studioRow.click()
  await expect(page.locator('.crew-island-done-title')).toHaveText('已交付')
})

test('chat members live in the room menu, not under the row', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample', { data: { kind: 'chat' } })).ok()).toBe(true)
  await page.goto('/')
  const row = page.locator('.crew-side-room[title^="示例：把「朏朏住在灵动岛上」"]')
  await row.hover()
  await page.getByRole('button', { name: /管理 示例：把「朏朏住在灵动岛上」/ }).click()
  await expect(page.getByRole('menuitem', { name: '历史' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: '成员' }).click()
  const members = page.getByRole('dialog', { name: '房间成员' })
  await expect(members).toBeVisible()
  await expect(members).toContainText('Lodge')
  await expect(members).toContainText('阿禾')
  await expect(page.locator('.dsb-side .crew-side-members')).toHaveCount(0)

  await members.getByRole('button', { name: /^阿禾/ }).click()
  await expect(page.locator('.crew-body-swap')).toBeVisible()
  await expect(page.locator('.crew-member-pop')).toHaveCount(0)
})
