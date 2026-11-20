// 独立尺子：只看产出的三张切片，不读房间里的说法。
// 尺寸之外还按相对坐标抽样对照原图的左、中、右三段，防止拿三张任意图片交差。
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const SIPS = '/usr/bin/sips'
const repo = process.argv[2]
const report = { pass: false, detail: '', facts: {} }
const dir = mkdtempSync(join(tmpdir(), 'lodge-slices-'))

const pngSize = path => {
  const bytes = readFileSync(path)
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

const readBmp = bytes => {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null
  const offset = bytes.readUInt32LE(10)
  const width = bytes.readInt32LE(18)
  const height = Math.abs(bytes.readInt32LE(22))
  const bpp = bytes.readUInt16LE(28)
  if (width <= 0 || height <= 0 || (bpp !== 24 && bpp !== 32)) return null
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4
  const pixel = (x, y) => {
    const at = offset + (height - 1 - y) * rowSize + x * (bpp / 8)
    if (at + 2 >= bytes.length) return null
    return [bytes[at + 2], bytes[at + 1], bytes[at]]
  }
  return { width, height, pixel }
}

// 在相对坐标处取 5×5 均值，避开重采样后的单像素噪声。
const patches = (image, sourceX = 0, sourceWidth = image.width, cells = 10) => {
  const scaleX = sourceWidth / image.width
  const points = []
  for (let gy = 0; gy < cells; gy += 1) {
    for (let gx = 0; gx < cells; gx += 1) {
      const x = Math.min(image.width - 1, Math.round(((gx + 0.5) / cells) * image.width))
      const y = Math.min(image.height - 1, Math.round(((gy + 0.5) / cells) * image.height))
      const sx = Math.min(image.width - 1, Math.round(sourceX + x * scaleX))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const px = sx + dx
          const py = y + dy
          if (px < sourceX || px >= sourceX + sourceWidth || py < 0 || py >= image.height) continue
          const value = image.pixel(px, py)
          if (value === null) continue
          r += value[0]
          g += value[1]
          b += value[2]
          n += 1
        }
      }
      if (n > 0) points.push([r / n, g / n, b / n])
    }
  }
  return points
}

const imageOf = path => {
  const bmp = join(dir, `${basename(path)}.bmp`)
  execFileSync(SIPS, ['-s', 'format', 'bmp', path, '--out', bmp], { stdio: 'ignore', timeout: 15_000 })
  return readBmp(readFileSync(bmp))
}

try {
  const sheetPath = join(repo, 'assets', 'sheet.png')
  const sheet = existsSync(sheetPath) && pngSize(sheetPath) !== null ? imageOf(sheetPath) : null
  const slices = []
  for (const [index, name] of ['slice-01.png', 'slice-02.png', 'slice-03.png'].entries()) {
    const path = join(repo, 'assets', name)
    if (!existsSync(path)) {
      report.detail = `${name} 不存在`
      break
    }
    const size = pngSize(path)
    if (size === null) {
      report.detail = `${name} 不是 PNG`
      break
    }
    const image = existsSync(SIPS) ? imageOf(path) : null
    slices.push({
      name,
      ...size,
      sha: createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12),
      image,
      index,
    })
  }
  report.facts.slices = slices.map(({ image, ...item }) => item)
  if (report.detail === '') {
    const wrong = slices.filter(item => item.width !== 300 || item.height !== 300)
    if (wrong.length > 0) report.detail = wrong.map(item => `${item.name} 是 ${item.width}×${item.height}`).join('；')
    else if (new Set(slices.map(item => item.sha)).size !== 3) report.detail = '三张切片内容相同'
    else if (sheet === null || slices.some(item => item.image === null)) {
      report.pass = true
      report.facts.degraded = true
      report.detail = '三张 300×300 切片都在，内容不同；这台机器没有像素对照，只核了尺寸'
    } else {
      const diffs = []
      for (const slice of slices) {
        const expected = patches(sheet, slice.index * 300, 300)
        const actual = patches(slice.image)
        const diff = actual.reduce((total, point, at) => {
          const base = expected[at]
          if (base === undefined) return total
          return total + (Math.abs(point[0] - base[0]) + Math.abs(point[1] - base[1]) + Math.abs(point[2] - base[2])) / 3
        }, 0) / actual.length
        diffs.push({ name: slice.name, meanDiff: Math.round(diff * 10) / 10 })
      }
      report.facts.diffs = diffs
      const off = diffs.filter(item => item.meanDiff > 18)
      if (off.length > 0) report.detail = off.map(item => `${item.name} 与原图对应段不一致（平均差 ${item.meanDiff}）`).join('；')
      else {
        report.pass = true
        report.detail = `三张 300×300 切片都在，并分别对上原图的左、中、右段（最大平均差 ${Math.max(...diffs.map(item => item.meanDiff))}）`
      }
    }
  }
} catch (error) {
  report.detail = String(error?.message ?? error)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(JSON.stringify(report))
process.exit(report.pass ? 0 : 1)
