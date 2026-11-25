// 探针报告的“真实厂商”：引擎和模型 id 是 Lodge 选的，实际请求可能被本机 CLI 的设置改到另一个端点。
// 只读本机 ~/.claude/settings.json；读不到就按默认 Anthropic 记，不猜。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const hostOf = url => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export const vendorOf = () => {
  let settings = null
  try {
    settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'))
  } catch {}
  const env = settings?.env ?? {}
  const base = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : ''
  const model = typeof env.ANTHROPIC_MODEL === 'string' ? env.ANTHROPIC_MODEL : ''
  if (base === '') return { label: 'Anthropic（默认端点）', base: '', model }
  const host = hostOf(base)
  const vendor = /deepseek/i.test(host)
    ? 'DeepSeek'
    : /openrouter/i.test(host)
      ? 'OpenRouter'
      : host
  return { label: `${vendor}（claude CLI → ${host}）`, base, model }
}
