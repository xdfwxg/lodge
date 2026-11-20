import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const pngSize = path => {
  const bytes = readFileSync(path)
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

const root = process.cwd()
const missing = []
for (const name of ['slice-01.png', 'slice-02.png', 'slice-03.png']) {
  const path = join(root, 'assets', name)
  if (!existsSync(path)) {
    missing.push(`${name} 不存在`)
    continue
  }
  const size = pngSize(path)
  if (size === null) missing.push(`${name} 不是 PNG`)
  else if (size.width !== 300 || size.height !== 300) missing.push(`${name} 是 ${size.width}×${size.height}，应为 300×300`)
}

if (missing.length > 0) {
  console.error(missing.join('；'))
  process.exit(1)
}
console.log('三张切片都在，尺寸正确')
