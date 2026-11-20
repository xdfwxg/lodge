import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const SIPS = '/usr/bin/sips'

const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

// 读 BMP 的像素。sips 输出 24/32 位、自下而上；只是抽样统计，不需要完整解码。
const readBmp = bytes => {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null
  const offset = bytes.readUInt32LE(10)
  const width = bytes.readInt32LE(18)
  const height = Math.abs(bytes.readInt32LE(22))
  const bpp = bytes.readUInt16LE(28)
  if (width <= 0 || height <= 0 || (bpp !== 24 && bpp !== 32)) return null
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)))
  const pixels = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const at = offset + (height - 1 - y) * rowSize + x * (bpp / 8)
      if (at + 2 >= bytes.length) continue
      pixels.push([bytes[at + 2], bytes[at + 1], bytes[at]])
    }
  }
  return { width, height, pixels }
}

// 平台侧的视觉检查：不看语义，只确认画面不是空白、不是纯色块、明暗有层次。
export const auditPng = async ({ file } = {}) => {
  if (typeof file !== 'string' || !existsSync(file) || !existsSync(SIPS)) return null
  const dir = mkdtempSync(join(tmpdir(), 'lodge-audit-'))
  const bmp = join(dir, 'shot.bmp')
  try {
    await run(SIPS, ['-s', 'format', 'bmp', file, '--out', bmp], { timeout: 10_000 })
    const image = readBmp(readFileSync(bmp))
    if (image === null || image.pixels.length === 0) return null
    const colors = new Set()
    const lums = []
    for (const [r, g, b] of image.pixels) {
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4))
      lums.push(luminance(r, g, b))
    }
    lums.sort((a, b) => a - b)
    // 用最暗和最亮像素衡量层次；大部分是白底小面积文字时，分位数会把对比算成 0。
    const low = lums[0]
    const high = lums[lums.length - 1]
    const mean = lums.reduce((sum, value) => sum + value, 0) / lums.length
    const variance = lums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lums.length
    const flat = Math.sqrt(variance) < 1.5 || colors.size < 2
    return {
      width: image.width,
      height: image.height,
      colors: colors.size,
      contrast: Math.round(high - low),
      blank: flat,
      notes: [
        flat ? '画面接近纯色，像没渲染出来' : `画面有 ${colors.size} 种颜色、明暗对比 ${Math.round(high - low)}`,
        `尺寸 ${image.width}×${image.height}`,
      ],
    }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
