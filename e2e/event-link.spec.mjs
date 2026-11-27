import { expect, test } from '@playwright/test'

// 外部事件入口在房间菜单里：开一次拿到地址，换地址作废旧地址，关掉后整条路消失。
test('a room opens, copies and closes its external event address', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample', { data: { kind: 'studio' } })).ok()).toBe(true)
  await page.goto('/')

  const row = page.locator('.crew-side-row').filter({ hasText: '示例：把《羽仙记》的结尾改得更看得见' }).first()
  await row.getByRole('button', { name: /^管理/ }).click()
  await page.getByRole('menuitem', { name: '外部事件…' }).click()

  const dialog = page.getByRole('dialog', { name: '外部事件' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('还没开启。开启后会得到一行地址。')).toBeVisible()

  await dialog.getByRole('button', { name: '开启' }).click()
  const address = dialog.getByRole('textbox', { name: '外部事件地址' })
  await expect(address).toBeVisible()
  const first = await address.inputValue()
  expect(first).toMatch(/\/api\/webhooks\/[\w-]+\/[a-f0-9]{48}$/)

  await dialog.getByRole('button', { name: '换一个地址' }).click()
  await expect.poll(async () => address.inputValue()).not.toBe(first)

  await dialog.getByRole('button', { name: '关掉' }).click()
  await expect(dialog).toHaveCount(0)

  // 关掉之后从菜单再打开，又回到“还没开启”。
  await row.getByRole('button', { name: /^管理/ }).click()
  await page.getByRole('menuitem', { name: '外部事件…' }).click()
  await expect(page.getByRole('dialog', { name: '外部事件' }).getByText('还没开启。开启后会得到一行地址。')).toBeVisible()
})
