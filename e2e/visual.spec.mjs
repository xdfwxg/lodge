import { expect, test } from '@playwright/test'

// 视觉基线只在产品目标平台录：Mac。Linux CI 没有同款字体与渲染，跳过而不是拿噪声当门槛。
test.skip(process.platform !== 'darwin', '视觉基线在 Mac 上录')

const openSample = async (page, request) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')
  // 示例聊天房可能也在；明确打开交付示例，别让默认选中决定这条视觉基线。
  await page.getByRole('button', { name: /^示例：把《羽仙记》的结尾改得更看得见，已交付$/ }).click()
  await expect(page.locator('.studio-result')).toBeVisible()
}

test('the delivered result card keeps its desktop layout', async ({ page, request }) => {
  await openSample(page, request)
  await expect(page.locator('.studio-result')).toHaveScreenshot('result-card.png', {
    animations: 'disabled',
    caret: 'hide',
    mask: [page.locator('.studio-delivery-at')],
    maxDiffPixelRatio: 0.01,
  })
})

test('the delivered result card keeps its narrow dark layout', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await openSample(page, request)
  await expect(page.locator('.studio-result')).toHaveScreenshot('result-card-dark-narrow.png', {
    animations: 'disabled',
    caret: 'hide',
    mask: [page.locator('.studio-delivery-at')],
    maxDiffPixelRatio: 0.01,
  })
})

test('the new room dialog keeps its layout', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新建房间' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveScreenshot('new-room-dialog.png', {
    animations: 'disabled',
    caret: 'hide',
    mask: [page.locator('.studio-delivery-at')],
    maxDiffPixelRatio: 0.01,
  })
})
