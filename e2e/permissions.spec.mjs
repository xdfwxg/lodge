import { expect, test } from '@playwright/test'

// 示例工作室是本地演示房，不需要真基座；这里只验证权限入口、三项和默认值。
test('the room permission dialog shows the three choices and their defaults', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample', { data: { kind: 'studio' } })).ok()).toBe(true)
  await page.goto('/')

  // 全套跑时旁边还有示例聊天房；按示例工作室的名字找行，不拿“第一行”。
  const row = page.locator('.crew-side-row').filter({ hasText: '示例：把《羽仙记》的结尾改得更看得见' }).first()
  await row.getByRole('button', { name: /^管理/ }).click()
  await page.getByRole('menuitem', { name: '权限…' }).click()

  const dialog = page.getByRole('dialog', { name: '房间权限' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '这间房能做什么' })).toBeVisible()
  await expect(dialog.getByRole('radio', { name: '直接改工作副本' })).toBeChecked()
  await expect(dialog.getByRole('radio', { name: '模型 + 允许的网站' })).toBeChecked()
  await expect(dialog.getByRole('radio', { name: '高风险动作先问我' })).toBeChecked()

  // 示例房的成员不是 pi，“只连模型”落不下去，所以必须禁用而不是假装可选。
  await expect(dialog.getByRole('radio', { name: '只连模型' })).toBeDisabled()
  // 换一档后取消，不改房间。
  await dialog.getByRole('radio', { name: '每一步都问我（改文件、跑命令）' }).check()
  await expect(dialog.getByRole('radio', { name: '每一步都问我（改文件、跑命令）' })).toBeChecked()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toHaveCount(0)
})
