import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const audit = page => new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  .analyze()

const expectClean = async page => {
  const results = await audit(page)
  expect(results.violations.map(item => ({
    id: item.id,
    help: item.help,
    nodes: item.nodes.map(node => ({ target: node.target.join(' '), html: node.html })),
  }))).toEqual([])
}

test('the first screen has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.dsb-main')).toBeVisible()
  await expectClean(page)
})

test('the sample delivery has no WCAG A/AA violations', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')
  await page.getByRole('button', { name: /^示例：把《羽仙记》的结尾改得更看得见，已交付$/ }).click()
  await expect(page.locator('.studio-delivery-name')).toBeVisible()
  await expectClean(page)

  await page.locator('.studio-delivery-details > summary').click()
  // 面板有进入动画；等透明度稳定后再量对比度。
  await page.waitForTimeout(500)
  await expectClean(page)
})

test('a narrow dark room has no WCAG A/AA violations', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('.studio-delivery-name')).toBeVisible()
  await expectClean(page)
})
