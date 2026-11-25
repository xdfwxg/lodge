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

test('the delivered island opens the goal panel again', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')
  await page.locator('.crew-side-room[title^="示例：把《羽仙记》的结尾改得更看得见"]').click()
  await expect(page.locator('.crew-island-done-title')).toHaveText('已交付')
  await page.locator('.crew-island-done-wrap').click()
  await expect(page.locator('.bt-goal-panel')).toBeVisible()
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

  const editor = members.locator('.crew-side-member-edit').filter({ hasText: '阿禾' })
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('combobox')).toBeVisible()
  await expect(members.getByRole('button', { name: '完成' })).toBeDisabled()
  await expect(page.locator('.crew-member-pop')).toBeVisible()
  await expect(page.locator('.crew-body-swap')).toHaveCount(0)
  // 示例房没连模型服务，成员只能看不能拨；静音开关只出现在真在跑的聊天室。
  await expect(members.getByRole('switch')).toHaveCount(0)
})
