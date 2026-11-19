import { randomUUID } from 'node:crypto'
import { fail, ok } from './result.js'

// 前门只说一句：有具体结果要交就开工作室，还在想就进聊天。
// 判断是语义问题，交给模型；权限、房型与成员仍由业务规则决定。
const INTENT_TIMEOUT_MS = 20_000

export const parseIntent = reply => {
  const text = String(reply ?? '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const raw = fenced?.[1] ?? (/\{[\s\S]*\}/.exec(text)?.[0] ?? '')
  if (raw.trim() === '') return null
  try {
    const data = JSON.parse(raw)
    const room = data?.room === 'chat' ? 'chat' : data?.room === 'studio' ? 'studio' : null
    if (room === null) return null
    const why = typeof data.why === 'string' ? data.why.trim().slice(0, 80) : ''
    return { room, why }
  } catch {
    return null
  }
}

const intentPrompt = goal => [
  `用户说：${goal}`,
  '判断：这句话要交一个具体结果（文件、清单、链接、对比表、代码、查价、订票等）→ studio；只是聊聊、拿主意、还没想清楚 → chat；拿不准就 chat。',
  '只回一行 JSON：{"room":"studio" 或 "chat","why":"不超过 30 字的中文理由"}。不要写方案，不要执行。',
].join('\n')

export const classifyIntent = async ({ probe, body, workspace, timeout = INTENT_TIMEOUT_MS } = {}) => {
  const goal = typeof body?.goal === 'string' ? body.goal.trim() : ''
  if (goal === '' || goal.length > 2000) return fail('invalid', '先说一句想做什么')
  // 判断不了也照常开工：默认按一件事开；聊天可以之后再转。
  if (probe?.available?.() !== true) return ok({ room: 'studio', why: '', fallback: true })
  const short = randomUUID().slice(0, 8)
  let timer = null
  try {
    await probe.start({
      name: `前台判断${short}`,
      soul: '你是 Lodge 的前台。只判断用户这句话要交结果还是想聊聊；不写方案、不执行、不调用工具。',
      description: '判断这句话该怎么开工',
      approval: 'auto',
      roomName: `前台判断 · ${short}`,
      goal,
      bulletin: goal,
      cwd: workspace.root(),
    })
    const reply = await Promise.race([
      probe.ask(intentPrompt(goal)),
      new Promise(resolve => { timer = setTimeout(() => resolve(''), timeout) }),
    ])
    const parsed = parseIntent(reply)
    return ok(parsed === null ? { room: 'studio', why: '', fallback: true } : parsed)
  } catch {
    return ok({ room: 'studio', why: '', fallback: true })
  } finally {
    clearTimeout(timer)
    await probe.stop()
  }
}
