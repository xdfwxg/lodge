import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const audit = page => new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  .analyze()

// 灵动岛和面板都有入场动画；动画没结束就量对比度，会量到半透明的中间态，
// 报出并不存在的对比度问题。等两帧让动画起身，再等所有有限动画结束。
const settle = page => page.evaluate(async () => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await Promise.all(
    document.getAnimations()
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {})),
  )
})

const expectClean = async page => {
  await settle(page)
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
  // 基座不可达时，第一屏要说明原因并给出重试，而不是无限停在“正在准备”。
  await expect(page.getByText('Lodge 还没准备好')).toBeVisible()
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  await expectClean(page)
})

test('the sample delivery has no WCAG A/AA violations', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')
  await page.getByRole('button', { name: /^示例：把《羽仙记》的结尾改得更看得见，已交付$/ }).click()
  await expect(page.locator('.studio-delivery-name')).toBeVisible()
  await expectClean(page)

  await page.locator('.crew-delivery-foot').hover()
  await page.locator('.crew-delivery-foot').getByRole('button', { name: '详情' }).click()
  // 面板展开后先等内容进 DOM，再量对比度。
  await expect(page.locator('.studio-delivery-details[open] .studio-delivery-detail-meta')).toBeVisible()
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
