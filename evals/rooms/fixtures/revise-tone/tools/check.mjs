import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const html = readFileSync(join(process.cwd(), 'draft', 'report.html'), 'utf8')
const failures = []
if (!/\.title\s*\{[^}]*font-size:\s*28px/.test(html)) failures.push('标题字号不是 28px')
if (!/\.figure\s*\{[^}]*border-radius:\s*8px/.test(html)) failures.push('图区圆角不是 8px')
if (failures.length > 0) {
  console.error(failures.join('；'))
  process.exit(1)
}
console.log('字号和圆角都改好了')
