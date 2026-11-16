import { expect, test } from '@playwright/test'

test('the sidebar drags into a single icon rail and back', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')

  const resizer = page.locator('.crew-side-resizer')
  await expect(resizer).toBeVisible()
  const box = await resizer.boundingBox()
  expect(box).not.toBeNull()

  await page.mouse.move(box.x + box.width / 2, box.y + 80)
  await page.mouse.down()
  await page.mouse.move(80, box.y + 80, { steps: 5 })
  await page.mouse.up()

  await expect(page.locator('body')).toHaveAttribute('data-side', 'rail')
  await expect(page.locator('.dsb-side')).toHaveCSS('width', '56px')
  await expect(page.locator('.crew-side-toggle')).toHaveCount(0)

  // 收起状态要能跨刷新保留；键盘右箭头从 rail 展开。
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-side', 'rail')
  await expect(page.locator('.dsb-side')).toHaveCSS('width', '56px')
  await page.locator('.crew-side-resizer').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('body')).not.toHaveAttribute('data-side', 'rail')
  await expect(page.locator('.dsb-side')).toHaveCSS('width', '200px')

  await page.reload()
  await expect(page.locator('.dsb-side')).toHaveCSS('width', '200px')

  const rail = await page.locator('.crew-side-resizer').boundingBox()
  expect(rail).not.toBeNull()
  await page.mouse.move(rail.x + rail.width / 2, rail.y + 80)
  await page.mouse.down()
  await page.mouse.move(300, rail.y + 80, { steps: 5 })
  await page.mouse.up()

  await expect(page.locator('body')).not.toHaveAttribute('data-side', 'rail')
  await expect(page.locator('.dsb-side')).toHaveCSS('width', '300px')
})
