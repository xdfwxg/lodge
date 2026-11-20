// 独立尺子：两处指定样式真的改了，其他文字和样式没有被顺手改掉。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.argv[2]
const report = { pass: false, detail: '', facts: {} }

try {
  const html = readFileSync(join(repo, 'draft', 'report.html'), 'utf8')
  const rules = [
    { id: 'title-size', test: /\.title\s*\{[^}]*font-size:\s*28px/, text: '标题字号不是 28px' },
    { id: 'figure-radius', test: /\.figure\s*\{[^}]*border-radius:\s*8px/, text: '图区圆角不是 8px' },
    { id: 'title-text', test: /季度报告/, text: '标题文字被改了' },
    { id: 'lede', test: /这一季的重点是把交付做稳/, text: '正文被改了' },
    { id: 'lede-color', test: /\.lede\s*\{[^}]*color:\s*#5b6370/, text: '正文颜色被改了' },
    { id: 'caption', test: /\.caption\s*\{[^}]*font-size:\s*13px/, text: '图注字号被改了' },
  ]
  const failures = rules.filter(rule => !rule.test.test(html))
  report.facts = {
    fontSize: /\.title\s*\{[^}]*font-size:\s*([^;]+);/.exec(html)?.[1]?.trim() ?? null,
    radius: /\.figure\s*\{[^}]*border-radius:\s*([^;]+);/.exec(html)?.[1]?.trim() ?? null,
    failures: failures.map(rule => rule.id),
  }
  if (/font-size:\s*14px/.test(html)) failures.push({ text: '旧的 14px 字号还在' })
  if (failures.length === 0) {
    report.pass = true
    report.detail = '字号、圆角改好，其他文字和样式没动'
  } else {
    report.detail = failures.map(rule => rule.text).join('；')
  }
} catch (error) {
  report.detail = String(error?.message ?? error)
}

console.log(JSON.stringify(report))
process.exit(report.pass ? 0 : 1)
