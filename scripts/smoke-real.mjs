// 真实环境冒烟：只读检查 Lodge、基座和本机模型路由，不建房间、不调模型。
// 用法：npm run smoke:real（可设 LODGE_URL、CREW_BASE_URL）。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const lodgeUrl = (process.env.LODGE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const baseUrl = (process.env.CREW_BASE_URL ?? 'http://127.0.0.1:8799').replace(/\/+$/, '')

const getJson = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

const modelRoute = () => {
  try {
    const settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'))
    return {
      base: settings.env?.ANTHROPIC_BASE_URL ?? 'anthropic',
      model: settings.env?.ANTHROPIC_MODEL ?? '(默认)',
    }
  } catch {
    return { base: '未知（没有本机 Claude 配置）', model: '未知' }
  }
}

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok, detail })

try {
  const lodge = await getJson(`${lodgeUrl}/api/health`)
  check('Lodge', lodge.status === 200 && lodge.body?.runtime?.ok === true, `${lodgeUrl} · 房间 ${lodge.body?.runtime?.rooms ?? '?'} 间`)
  if (lodge.status === 200) {
    const state = await getJson(`${lodgeUrl}/api/state`)
    check('状态接口', state.status === 200 && Array.isArray(state.body?.rooms), `${state.body?.rooms?.length ?? 0} 间可读`)
  }
} catch (error) {
  check('Lodge', false, `${lodgeUrl} · ${error?.message ?? error}`)
}

try {
  const base = await getJson(`${baseUrl}/api/health`)
  check('基座', base.status === 200 && base.body?.app === 'openmausbot', `${baseUrl} · ${base.body?.version ?? '?'}`)
} catch (error) {
  check('基座', false, `${baseUrl} · ${error?.message ?? error}`)
}

const route = modelRoute()
check('模型路由', true, `${route.base} · ${route.model}`)

for (const item of checks) console.log(`${item.ok ? '✔' : '✘'} ${item.name}：${item.detail}`)
if (checks.some(item => !item.ok)) process.exit(1)
