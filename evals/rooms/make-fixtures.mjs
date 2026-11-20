// 固定题要能重放：图片不靠手工切，脚本生成同样的三维色带。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = dirname(fileURLToPath(import.meta.url))

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

const crc32 = bytes => {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

const png = (width, height, pixelAt) => {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y)
      const at = row + 1 + x * 3
      raw[at] = r
      raw[at + 1] = g
      raw[at + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const bands = [
  { from: [232, 84, 72], to: [255, 178, 89] },
  { from: [46, 156, 120], to: [126, 214, 168] },
  { from: [58, 104, 196], to: [122, 162, 255] },
]

// 每条带子有渐变和斜纹，切错边或缩放也能一眼看出来。
const sheetAt = (x, y) => {
  const band = bands[Math.min(2, Math.floor(x / 300))]
  const t = (y / 300) * 0.7 + ((x % 300) / 300) * 0.3
  const stripe = (x + y) % 60 < 8 ? 28 : 0
  return band.from.map((value, index) => Math.max(0, Math.min(255, Math.round(value + (band.to[index] - value) * t - stripe))))
}

const write = (path, bytes) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
  console.log(`${path} · ${bytes.length} bytes`)
}

write(join(root, 'fixtures', 'slice-sheet', 'assets', 'sheet.png'), png(900, 300, sheetAt))
