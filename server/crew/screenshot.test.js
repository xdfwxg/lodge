// 视觉证据的真实链路：Chrome 截一张本地 HTML，再用平台解码器读回像素。
// 没有 Chrome 或 sips 的机器跳过，不让交付因为本机缺工具而红。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureHtml, chromePath } from './screenshot.js'
import { auditPng } from './visual-audit.js'

const chrome = chromePath()
const sips = '/usr/bin/sips'
const canCapture = chrome !== '' && existsSync(sips)

const page = body => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; }
  body { background: #ffffff; color: #111111; font: 28px -apple-system, sans-serif; }
</style></head><body>${body}</body></html>`

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
    assert.equal(await captureHtml({ file: source, out, width: 900, height: 700 }), out)
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
    assert.equal(await captureHtml({ file: source, out, width: 600, height: 400 }), out)
    const audit = await auditPng({ file: out })
    assert.notEqual(audit, null)
    assert.equal(audit.blank, true)
    assert.match(audit.notes[0], /接近纯色/)
  } finally {
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
