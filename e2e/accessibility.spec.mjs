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
  await expect(page.getByRole('heading', { name: 'Lodge' })).toBeVisible()
  await expectClean(page)
})

test('the sample room, result card and goal panel have no WCAG A/AA violations', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '示例：发布前检查清单' })).toBeVisible()
  await expectClean(page)

  await page.locator('.bt-goal-closed').click()
  await page.getByRole('button', { name: '目标和检查' }).click()
  await expect(page.getByText('结果', { exact: true }).first()).toBeVisible()
  await expectClean(page)
})

test('a narrow dark room has no WCAG A/AA violations', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '示例：发布前检查清单' })).toBeVisible()
  await expectClean(page)
})
