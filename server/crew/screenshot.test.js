// 视觉证据的真实链路：Chrome 截一张本地 HTML，再用平台解码器读回像素。
// 没有 Chrome 或 sips 的机器跳过，不让交付因为本机缺工具而红。
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { captureHtml, chromePath } from './screenshot.js'
import { auditPng } from './visual-audit.js'

const chrome = chromePath()
const sips = '/usr/bin/sips'
const canCapture = chrome !== '' && existsSync(sips)

const sipsRun = promisify(execFile)
// 截图里有没有那块标记色（这张样图是粉红）：直接读像素，不靠“看起来像”。
const hasRed = async file => {
  const bmp = `${file}.bmp`
  await sipsRun('/usr/bin/sips', ['-s', 'format', 'bmp', file, '--out', bmp], { timeout: 10_000 })
  const bytes = readFileSync(bmp)
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) return false
  const offset = bytes.readUInt32LE(10)
  const step = Math.max(3, bytes.readUInt16LE(28) / 8)
  for (let index = offset; index + 2 < bytes.length; index += step) {
    // 粉红：红通道高，绿蓝明显低于红；白和灰都不满足。
    if (bytes[index + 2] > 200 && bytes[index + 1] < 200 && bytes[index] < 200) return true
  }
  return false
}

const page = body => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; }
  body { background: #ffffff; color: #111111; font: 28px -apple-system, sans-serif; }
</style></head><body>${body}</body></html>`

// 机器忙的时候 Chrome 可能没在时限内出图（返回 null）。那不是这几条测试要证明的事——
// 换个时机再截一次；真的读得到文件时，图照样会出来并被下面的像素检查抓住。
const capture = async input => (await captureHtml(input)) ?? captureHtml(input)

test('a rendered page becomes a real PNG', { skip: !canCapture && `missing Chrome (${chrome || 'none'}) or sips` }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-shot-test-'))
  try {
    const source = join(dir, 'page.html')
    const out = join(dir, 'shot.png')
    writeFileSync(source, page(`
      <h1 style="margin:24px">发布检查</h1>
      <p style="margin:24px">新人照着勾。</p>
      <div style="height:120px;background:#1a6b3c;margin:24px"></div>
    `))
    assert.equal(await capture({ file: source, out, width: 900, height: 700 }), out)
    const bytes = readFileSync(out)
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    const audit = await auditPng({ file: out })
    assert.notEqual(audit, null)
    assert.equal(audit.blank, false)
    assert.ok(audit.colors >= 2)
    assert.ok(audit.contrast > 0)
    assert.equal(audit.width, 900)
    assert.equal(audit.height, 700)
    assert.match(audit.notes[0], /种颜色/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty page is reported as blank, not as a good preview', { skip: !canCapture && 'missing Chrome or sips' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-shot-blank-'))
  try {
    const source = join(dir, 'blank.html')
    const out = join(dir, 'blank.png')
    writeFileSync(source, page(''))
    assert.equal(await capture({ file: source, out, width: 600, height: 400 }), out)
    const audit = await auditPng({ file: out })
    assert.notEqual(audit, null)
    assert.equal(audit.blank, true)
    assert.match(audit.notes[0], /接近纯色/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// 渲染器也是读入口：页面不能借 file:// 读到沙箱拒绝的文件。
test('rendered HTML cannot read local files', { skip: !canCapture && `missing Chrome (${chrome || 'none'}) or sips` }, async () => {
  const red = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
    'base64',
  )
  const dir = mkdtempSync(join(tmpdir(), 'lodge-shot-read-'))
  const secretDir = mkdtempSync(join(tmpdir(), 'lodge-shot-secret-'))
  try {
    const secret = join(secretDir, 'secret.png')
    writeFileSync(secret, red)

    const escape = join(dir, 'escape.html')
    writeFileSync(escape, page(`<img src="file://${secret}" style="width:600px;height:400px">`))
    const escapeOut = join(dir, 'escape.png')
    assert.equal(await capture({ file: escape, out: escapeOut }), escapeOut)
    assert.equal(await hasRed(escapeOut), false, 'a file:// image must not load')

    // 对照：同一张图内联成 data:，页面照样能把它渲染出来。
    const inline = join(dir, 'inline.html')
    writeFileSync(inline, page(`<img src="data:image/png;base64,${red.toString('base64')}" style="width:600px;height:400px">`))
    const inlineOut = join(dir, 'inline.png')
    assert.equal(await capture({ file: inline, out: inlineOut }), inlineOut)
    assert.equal(await hasRed(inlineOut), true, 'a data: image still renders')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(secretDir, { recursive: true, force: true })
  }
})

// 渲染器是 agent 内容的执行点：页面里的远程资源不能被它抓出去。
test('rendered HTML cannot reach the network', { skip: !canCapture && `missing Chrome (${chrome || 'none'}) or sips` }, async () => {
  const hits = []
  const server = http.createServer((request, response) => {
    hits.push(request.url)
    response.end('ok')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const dir = mkdtempSync(join(tmpdir(), 'lodge-shot-net-'))
  try {
    const source = join(dir, 'net.html')
    writeFileSync(source, page(`<img src="http://127.0.0.1:${port}/pixel">`))
    const out = join(dir, 'shot.png')
    assert.equal(await capture({ file: source, out }), out, 'the page still renders')
    await new Promise(resolve => setTimeout(resolve, 800))
    assert.deepEqual(hits, [], 'nothing may leave through the renderer')
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('missing inputs fail closed instead of producing an empty claim', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-shot-missing-'))
  try {
    assert.equal(await captureHtml({ file: join(dir, 'nope.html'), out: join(dir, 'x.png') }), null)
    assert.equal(await captureHtml({ file: undefined, out: join(dir, 'x.png') }), null)
    assert.equal(await auditPng({ file: join(dir, 'nope.png') }), null)
    assert.equal(await auditPng({}), null)
    const notImage = join(dir, 'not.png')
    writeFileSync(notImage, 'not a png')
    assert.equal(await auditPng({ file: notImage }), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
