import { expect, test } from '@playwright/test'

// 预算不是跑分：只拦明显回退。CI 比本机慢，阈值给足余量。
const within = (label, ms, actual) => expect(actual, `${label}: ${Math.round(actual)}ms`).toBeLessThan(ms)

test('the first screen reaches the result within budget', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample')).ok()).toBe(true)
  const started = Date.now()
  await page.goto('/')
  await expect(page.locator('.studio-delivery-name')).toBeVisible()
  const elapsed = Date.now() - started
  console.log(`budget first screen: ${elapsed}ms`)
  within('first screen', 5000, elapsed)
})

test('a 300-message room renders within budget and without overflow', async ({ page, request }) => {
  expect((await request.post('/api/rooms/sample', { data: { kind: 'chat' } })).ok()).toBe(true)
  const state = await (await request.get('/api/state')).json()
  const room = state.rooms.find(item => item.demo === true && item.roomType === 'chat')
  expect(room).toBeTruthy()
  const base = Date.now() - 300_000
  room.messages = Array.from({ length: 300 }, (_, index) => ({
    id: `budget-${index}`,
    kind: 'chat',
    authorId: index % 2 === 0 ? 'a' : 'b',
    text: `第 ${index + 1} 条消息：把这一段话读一遍。`,
    ts: base + index * 1000,
  }))
  await page.route('**/api/state', route => route.fulfill({ json: state }))
  const started = Date.now()
  await page.goto('/')
  const row = page.locator('.crew-side-room', { hasText: '朏朏' }).first()
  if (await row.getAttribute('aria-current') !== 'page') await row.click()
  await expect(page.getByText('第 300 条消息：把这一段话读一遍。')).toBeVisible()
  const elapsed = Date.now() - started
  console.log(`budget long timeline: ${elapsed}ms`)
  within('long timeline', 5000, elapsed)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  expect(await page.locator('.crew-msg').count()).toBeGreaterThan(100)
})

test('20 concurrent state reads stay within budget', async ({ request }) => {
  const started = Date.now()
  const responses = await Promise.all(Array.from({ length: 20 }, () => request.get('/api/state')))
  const elapsed = Date.now() - started
  expect(responses.every(response => response.ok())).toBe(true)
  console.log(`budget concurrent reads: ${elapsed}ms`)
  within('concurrent reads', 5000, elapsed)
})
