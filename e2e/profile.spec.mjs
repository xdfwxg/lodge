import { expect, test } from '@playwright/test'

const openEmailForm = async page => {
  await page.locator('button.crew-side-me').click()
  const dialog = page.locator('.crew-dialog.crew-profile')
  await dialog.getByRole('button', { name: '连接', exact: true }).click()
  return dialog
}

// 常用邮箱只问两个字段：发件邮箱和应用密码，服务器地址自动认。
test('a known provider saves with just the address and app password', async ({ page, request }) => {
  // 没有房间时首页先显示模型就绪页；建一间示例房，进到侧栏再开「你」。
  expect((await request.post('/api/rooms/sample', { data: { kind: 'chat' } })).ok()).toBe(true)
  await page.goto('/')
  const dialog = await openEmailForm(page)
  await dialog.getByLabel('发件邮箱').fill('nrt218@126.com')
  await expect(dialog.getByText('已识别 126 邮箱')).toBeVisible()
  await dialog.getByLabel('应用密码').fill('secret')
  await expect(dialog.getByRole('button', { name: '保存并关闭' })).toBeVisible()
  await dialog.getByRole('button', { name: '保存并关闭' }).click()
  await expect(dialog).toHaveCount(0)

  const settings = (await (await request.get('/api/settings/email')).json()).settings
  expect(settings.configured).toBe(true)
  expect(settings.host).toBe('smtp.126.com')
  expect(settings.port).toBe(465)
  expect(settings.secure).toBe(true)
  expect(settings.from).toBe('nrt218@126.com')
  // 密码不回传。
  expect(JSON.stringify(settings)).not.toContain('secret')

  expect((await request.post('/api/settings/email', { data: { action: 'clear' } })).ok()).toBe(true)
})

test('an unknown provider is refused with a hint instead of guessing', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample', { data: { kind: 'chat' } })).ok()).toBe(true)
  await page.goto('/')
  const dialog = await openEmailForm(page)
  await dialog.getByLabel('发件邮箱').fill('me@example.com')
  await dialog.getByLabel('应用密码').fill('secret')
  await expect(dialog.getByText('没认出这家邮箱；先用 126、163、QQ、Gmail、Outlook 这类常见邮箱。')).toBeVisible()
  await dialog.getByRole('button', { name: '保存并关闭' }).click()
  await expect(dialog.getByRole('status')).toContainText('没认出这家邮箱')
  // 没有落盘：还停在表单里等主机和端口。
  const settings = (await (await request.get('/api/settings/email')).json()).settings
  expect(settings.configured).toBe(false)
  await page.keyboard.press('Escape')
})
