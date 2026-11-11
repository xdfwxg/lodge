import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { workspaceRoot } from './paths.js'
import { fail, ok } from './result.js'
import { roleSeats, rosterFromRoles, validateRoster } from './seats.js'
import { defaultWorkspace, workspaceById } from './workspace.js'

const MAX_GOAL = 2000
const RECOMMEND_TIMEOUT = 90_000
const ROLE_LABEL = { lead: '队长', worker: '执行', verifier: '验收' }

// 编队是语义判断，归队长：先看目标与仓库事实，再决定需要几个席位。
const recommendationPrompt = (goal, repoPath) => [
  '你是队长。现在只做编队判断：不写代码、不改文件、不建群。',
  `目标：${goal}`,
  `工作目录（只读副本）：${repoPath}`,
  '先看仓库事实（README、package.json、测试命令、目录结构），再判断这件事需要几个席位：',
  '- 一个人能完成的小改动 → 只给一个执行席位（单人房）。不要为了凑人数加席位。',
  '- 只有需要独立验收时才加验收席位。',
  '- 只有工作能明确拆给多人并行时才加多个执行席位。',
  '- 至少一个执行；最多一个队长；验收可多个（每个独立复核，全部 PASS 才签字）；总席位 1–8。',
  '- 验收优先用仓库里真实可跑的命令；只写一条短命令（如 `npm test`、`test -f hello.txt`），不要内联多行脚本；命令太长或不可靠就设为 manual。',
  '- 只问真正要人拍板的问题；最多 3 个，每个带推荐答案；没有就空数组。',
  '- done 写 1–6 条可核对的完成条件，不要写口号。',
  '- JSON 代码块必须完整闭合。',
  '只输出一个 JSON 代码块，不要其他文字：',
  '```json',
  '{',
  '  "done": ["可核对的完成条件"],',
  '  "questions": [',
  '    {"text": "真正要人拍板的问题", "recommendation": "推荐答案"}',
  '  ],',
  '  "seats": [',
  '    {"role": "worker", "name": "执行", "reason": "为什么需要这个席位"}',
  '  ],',
  '  "verify": "test",',
  '  "acceptance": "在仓库根目录可执行的验收命令",',
  '  "why": "一句话说明为什么是这个编制"',
  '}',
  '```',
].join('\n')

const extractJsonBlock = reply => {
  const text = String(reply ?? '')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let at = start; at < candidate.length; at += 1) {
    const char = candidate[at]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return candidate.slice(start, at + 1)
    }
  }
  return null
}

// 模型只给语义建议；权限、席位上限与验收方式仍在这里由业务规则校验。
export const parseProposal = reply => {
  const json = extractJsonBlock(reply)
  if (json === null) throw new Error('队长没有给出可解析的编制建议')
  let data
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('队长给出的编制建议不是合法 JSON')
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.seats)) {
    throw new Error('开工方案缺少 seats')
  }
  const done = Array.isArray(data.done)
    ? data.done
      .filter(item => typeof item === 'string' && item.trim() !== '')
      .map(item => item.trim().slice(0, 200))
      .slice(0, 6)
    : []
  if (done.length === 0) throw new Error('开工方案缺少可核对的 done')
  const tooManyDone = Array.isArray(data.done) && data.done.length > 6
  const questions = Array.isArray(data.questions)
    ? data.questions
      .map(item => ({
        text: typeof item?.text === 'string' ? item.text.trim().slice(0, 300) : '',
        recommendation: typeof item?.recommendation === 'string' ? item.recommendation.trim().slice(0, 300) : '',
      }))
      .filter(item => item.text !== '')
      .slice(0, 3)
      .map(item => ({ ...item, recommendation: item.recommendation === '' ? '按推荐' : item.recommendation }))
    : []
  const tooManyQuestions = Array.isArray(data.questions) && data.questions.length > 3

  const entries = data.seats.map((seat, index) => {
    const role = seat?.role
    if (!['lead', 'worker', 'verifier'].includes(role)) {
      throw new Error(`第 ${index + 1} 个席位角色不合法`)
    }
    const rawName = typeof seat.name === 'string' ? seat.name.trim() : ''
    const reason = typeof seat.reason === 'string' ? seat.reason.trim().slice(0, 160) : ''
    return {
      role,
      name: (rawName === '' ? ROLE_LABEL[role] : rawName).slice(0, 32),
      reason,
    }
  })

  let roster
  try {
    roster = rosterFromRoles(entries.map(({ role, name }) => ({ role, name })))
    validateRoster(roster)
  } catch (error) {
    throw new Error(`编制不可用：${error?.message ?? error}`)
  }
  const verifiers = roleSeats(roster).verifiers

  const rawAcceptance = typeof data.acceptance === 'string' ? data.acceptance.trim() : ''
  const manual = data.verify === 'manual' || rawAcceptance === ''
  if (manual && verifiers.length > 0) {
    throw new Error('有验收席位时需要可执行验收命令；去掉验收席位或补一条命令')
  }
  const notes = [
    data.verify === 'test' && rawAcceptance === '' ? '队长没有给出可执行命令，验收改为你确认' : '',
    tooManyQuestions ? '队长给了超过 3 个问题，只保留前 3 个' : '',
    tooManyDone ? '队长给了超过 6 条 done，只保留前 6 条' : '',
  ].filter(Boolean)
  return {
    done,
    questions,
    seats: roster.map((seat, index) => ({
      role: seat.role,
      name: seat.name,
      reason: entries[index]?.reason ?? '',
    })),
    verify: manual ? 'manual' : 'test',
    acceptance: manual ? '' : rawAcceptance,
    why: typeof data.why === 'string' ? data.why.trim().slice(0, 300) : '',
    note: notes.join(' · '),
  }
}

const waitForTurn = async ({ engine, sessionRef }) => {
  const deadline = Date.now() + RECOMMEND_TIMEOUT
  while (Date.now() < deadline) {
    const { messages } = await engine.history(sessionRef, { limit: 100 })
    const turn = [...messages].reverse().find(message => (
      message.kind === 'turn' &&
      typeof message.turn?.reply === 'string' &&
      message.turn.reply.trim() !== ''
    ))
    if (turn !== undefined) {
      // 基座 digest 可能截断长回复；原文在席位线程的 text 消息里，优先取含 seats 的最长一段。
      const candidates = [
        turn.turn.reply,
        ...messages
          .filter(message => message.kind === 'text' && message.role === 'agent' && typeof message.text === 'string')
          .map(message => message.text),
      ].filter(text => text.trim() !== '')
      const withSeats = candidates.filter(text => text.includes('"seats"'))
      const pool = withSeats.length > 0 ? withSeats : candidates
      return pool.sort((a, b) => b.length - a.length)[0] ?? turn.turn.reply
    }
    const failed = [...messages].reverse().find(message => (
      message.kind === 'activity' && message.meta?.ok === false
    ))
    if (failed !== undefined) throw new Error(`队长回合失败：${failed.text}`)
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error('队长在 90 秒内没有给出编制建议')
}

export const recommendRoster = async ({ engine, body }) => {
  const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
  if (goal === '' || goal.length > MAX_GOAL) return fail('invalid', '目标不能为空，且不超过 2000 字')
  if (engine.capabilities().provisioning !== true) return fail('conflict', '当前 runtime 不支持编队建议')
  const health = await engine.health()
  if (health.ok !== true) throw new Error('基座未连接，先检查 CLI 或基座服务')

  const requestedRepo = typeof body.repoPath === 'string' ? body.repoPath.trim() : ''
  const generatedRepo = requestedRepo === ''
  const short = randomUUID().slice(0, 6)
  const sourceRepo = generatedRepo ? join(workspaceRoot(), `roster-${short}`) : resolve(requestedRepo)
  let workspace = defaultWorkspace
  if (!generatedRepo) {
    if (!existsSync(sourceRepo)) return fail('invalid', '工作目录不存在')
    // 建议是只读的；不在用户目录里 git init 或写文件。
    if (!defaultWorkspace.probeSource({ source: sourceRepo }).ok) {
      workspace = workspaceById('plain')
      const probe = workspace.probeSource({ source: sourceRepo })
      if (!probe.ok) return fail('invalid', probe.error)
    }
  }
  const advisor = rosterFromRoles([{ role: 'lead', name: '队长' }])[0]
  const prompt = recommendationPrompt(goal, sourceRepo)
  advisor.prompt = prompt
  // 只读克隆是一次性工作区；不弹审批，避免读仓库时卡在 permission 卡上。
  advisor.approval = 'auto'

  let workspaces = null
  let advisorRef = null
  let probeRoom = null
  try {
    workspaces = workspace.prepareRoom({ source: sourceRepo, short, seats: [advisor] })
    advisorRef = await engine.createSeatBot({
      name: `Advisor${short}`,
      soul: advisor.prompt,
      description: advisor.station,
      approval: advisor.approval,
      mcp: advisor.mcp,
    })
    probeRoom = await engine.createRoom({
      name: `编队建议 · ${short}`,
      goal,
      bulletin: `目标：${goal}\n仓库：${sourceRepo}`,
      members: [advisorRef.id],
      cwd: workspaces.seats[advisor.id].path,
      leadId: advisorRef.id,
    })
    await engine.sendTurn({ roomId: probeRoom.id, text: prompt })
    const reply = await waitForTurn({ engine, sessionRef: probeRoom.sessionRef })
    let proposal
    try {
      proposal = parseProposal(reply)
    } catch (error) {
      console.warn('roster recommendation unparsed:', String(reply).slice(0, 500))
      return fail('invalid', error?.message ?? String(error))
    }
    return ok({ proposal })
  } finally {
    if (probeRoom !== null) {
      try {
        await engine.cancelTurn({ roomId: probeRoom.id })
      } catch {}
      await engine.deleteRoom(probeRoom.id)
    }
    if (advisorRef !== null) await engine.deleteSeatBot(advisorRef.id)
    try {
      if (workspaces !== null) workspace.cleanupRoom({ source: sourceRepo, workspaces })
    } catch {}
    if (generatedRepo) rmSync(sourceRepo, { recursive: true, force: true })
  }
}
