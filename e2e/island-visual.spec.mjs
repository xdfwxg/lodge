import { expect, test } from '@playwright/test'

// 灵动岛是产品最富的一处；它的布局和安静模式也值得有基线。
// 与视觉基线一样只在 Mac 录：Linux 的字体和渲染会把噪声当差异。
test.skip(process.platform !== 'darwin', '视觉基线在 Mac 上录')

const shot = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixelRatio: 0.01,
}

test('the delivered island keeps its desktop layout', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.goto('/')
  // 前面的用例可能把选中的房间换掉；先明确选中已交付的示例房，岛的高度才稳定。
  await page.locator('.crew-side-room[title^="示例：把《羽仙记》"]').click()
  await expect(page.locator('.studio-result')).toBeVisible()
  const island = page.locator('.crew-goal-island')
  await expect(island).toBeVisible()
  await expect(island).toHaveScreenshot('island-delivered.png', shot)
})

test('the concluded chat island keeps its layout', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample', { data: { kind: 'chat' } })).ok()).toBe(true)
  await page.goto('/')
  await page.locator('.crew-side-room[title^="示例：把「朏朏住在灵动岛上」"]').click()
  const island = page.locator('.crew-goal-island')
  await expect(island.locator('.bt-goal-mini-title')).toHaveText('聊到这儿了')
  await expect(island).toHaveScreenshot('island-chat-concluded.png', shot)
})

test('the island stays small and quiet when motion is reduced', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const island = page.locator('.crew-goal-island')
  await expect(island).toBeVisible()
  const nodes = await island.evaluate(node => node.querySelectorAll('*').length)
  // 一屏只留一个决定；岛的 DOM 不能随着动效越堆越多。
  expect(nodes).toBeLessThan(300)
  // 进场过渡可能刚触发；等它结束，而不是把上一屏的过渡算成常驻动效。
  await expect.poll(
    () => island.evaluate(node => node.getAnimations({ subtree: true })
      .filter(animation => animation.playState === 'running').length),
    { timeout: 3_000 },
  ).toBe(0)
})
