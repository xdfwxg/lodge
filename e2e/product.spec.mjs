import { expect, test } from '@playwright/test'

// 示例房第一次发消息后会停下；草稿检查要排在它之前，否则输入框已经禁用。
test('a room keeps its unsent draft across a reload', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')

  await page.getByRole('combobox', { name: '房间消息' }).fill('先写到一半')
  await page.reload()
  const composer = page.getByRole('combobox', { name: '房间消息' })
  await expect(composer).toHaveValue('先写到一半')
  // 清空后草稿不该留着，免得下次进来看见旧话。
  await composer.fill('')
  await page.reload()
  await expect(page.getByRole('combobox', { name: '房间消息' })).toHaveValue('')
})

test('new room dialog, sample chat and archive restore', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample', { data: { kind: 'chat' } })).ok()).toBe(true)
  await page.goto('/')
  await expect(page.getByRole('button', { name: /^示例：把「朏朏住在灵动岛上」聊成一个方向，进行中$/ })).toBeVisible()

  await page.getByRole('button', { name: '新建房间' }).click()
  await expect(page.getByRole('heading', { name: '新房间' })).toBeVisible()
  await expect(page.getByRole('button', { name: '先聊聊' })).toBeVisible()
  await page.getByRole('button', { name: '先聊聊' }).click()
  await expect(page.getByLabel('想聊什么？')).toBeVisible()
  await page.getByRole('button', { name: '交给工作室' }).click()
  await expect(page.getByLabel('要做什么？')).toBeVisible()
  await expect(page.getByRole('button', { name: '开工', exact: true })).toBeDisabled()
  await page.getByLabel('要做什么？').fill('把启动说明补成新人能照着跑的一页')
  // 测试环境故意不接基座；没有可用模型时开工必须继续禁用，而不是等服务端拒绝。
  await expect(page.getByRole('button', { name: '开工', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const composer = page.getByRole('combobox', { name: '房间消息' })
  await expect(composer).toHaveAttribute('placeholder', '示例房间不接模型 · 已停在结论')
  await composer.fill('继续讨论一轮')
  await composer.press('Enter')
  await expect(page.getByText('继续讨论一轮').last()).toBeVisible()
  await expect(composer).toHaveValue('')

  await page.getByRole('button', { name: '转成工作室' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('工作文件夹').first()).toBeVisible()
  await page.keyboard.press('Escape')

  const state = await (await request.get('/api/state')).json()
  const id = state.rooms.find(room => room.demo === true && room.roomType === 'chat')?.id
  expect(id).toBeTruthy()
  expect((await request.post(`/api/rooms/${id}/archive`, { data: { archived: true } })).ok()).toBe(true)
  await page.reload()
  // 行内的“⋯”只在悬停或键盘聚焦时出现；先让行进入悬停态。
  await page.getByRole('button', { name: /示例：把「朏朏住在灵动岛上」.*已归档/ }).hover()
  await page.getByRole('button', { name: /管理 示例：把「朏朏住在灵动岛上」/ }).click()
  await page.getByRole('menuitem', { name: '取消归档' }).click()
  await expect(page.getByText(/示例：把「朏朏住在灵动岛上」/).first()).toBeVisible()
})

test('opening a detail keeps the reading position', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')
  await page.getByRole('button', { name: /^示例：把《羽仙记》的结尾改得更看得见，已交付$/ }).click()

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

test('expanding the delivery details keeps the reading position', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')
  await page.getByRole('button', { name: /^示例：把《羽仙记》的结尾改得更看得见，已交付$/ }).click()

  const scroller = page.locator('.dsb-scroll')
  await page.locator('.studio-delivery-details > summary').click()
  const summary = page.locator('.studio-delivery-details .crew-fold > summary').first()
  await summary.evaluate(node => node.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(50)
  const before = await summary.boundingBox()
  const scrollBefore = await scroller.evaluate(node => node.scrollTop)
  await summary.evaluate(node => node.click())
  await page.waitForTimeout(120)
  const after = await summary.boundingBox()
  const scrollAfter = await scroller.evaluate(node => node.scrollTop)
  expect(scrollAfter).toBe(scrollBefore)
  expect(Math.abs(after.y - before.y)).toBeLessThan(1)
})

test('expanding new-room options keeps the dialog anchored', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新建房间' }).click()

  const dialog = page.locator('.crew-dialog')
  const summary = page.locator('.crew-new-advanced > summary')
  await summary.scrollIntoViewIfNeeded()
  await page.waitForTimeout(50)
  const summaryBefore = await summary.boundingBox()
  const dialogBefore = await dialog.boundingBox()
  await summary.evaluate(node => node.click())
  await page.waitForTimeout(120)
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
  await page.getByRole('button', { name: /^示例：把《羽仙记》的结尾改得更看得见，已交付$/ }).click()
  await expect(page.locator('.studio-delivery-name')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('a delivered room keeps one send control with a next-version menu', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')
  await page.getByRole('button', { name: /^示例：把《羽仙记》的结尾改得更看得见，已交付$/ }).click()

  await page.getByRole('combobox', { name: '房间消息' }).fill('再改一版')
  await page.getByRole('button', { name: '更多提交方式' }).click()
  await expect(page.getByRole('menuitem', { name: /接着改，开下一版/ })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /原班人马和工作区沿用/ })).toBeVisible()
})
