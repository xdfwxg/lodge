import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { defaultOrchestrationId, resolveAssigneeTokens, resolveOrchestration } from './orchestration/index.js'
import { fail, ok } from './result.js'
import { roleMembers, rosterFromRoles, validateRoster } from './roster.js'
import { handoffGoalText, normalizeHandoff } from '../../shared/handoff.js'

const MAX_GOAL = 2000
const ROLE_ALIASES = new Map([
  ['lead', 'lead'], ['leader', 'lead'], ['planner', 'lead'], ['planning', 'lead'], ['队长', 'lead'], ['规划', 'lead'], ['负责人', 'lead'], ['规划者', 'lead'], ['规划师', 'lead'], ['主控', 'lead'],
  ['worker', 'worker'], ['executor', 'worker'], ['implementer', 'worker'], ['developer', 'worker'], ['engineer', 'worker'], ['执行', 'worker'], ['执行官', 'worker'], ['开发', 'worker'], ['开发者', 'worker'], ['工程师', 'worker'], ['实现', 'worker'],
  ['verifier', 'verifier'], ['reviewer', 'verifier'], ['review', 'verifier'], ['qa', 'verifier'], ['tester', 'verifier'], ['验收', 'verifier'], ['验收者', 'verifier'], ['验收员', 'verifier'], ['复核', 'verifier'], ['复核者', 'verifier'], ['评审', 'verifier'], ['审查', 'verifier'],
])
const normalizeRole = role => {
  if (typeof role !== 'string') return null
  const raw = role.trim()
  return ROLE_ALIASES.get(raw) ?? ROLE_ALIASES.get(raw.toLowerCase()) ?? null
}

// 编队是语义判断，归规划师：先看目标与仓库事实，再决定需要几个成员。
const recommendationPrompt = (goal, repoPath, handoff = null) => [
  '你是规划师。现在只做编队判断：不写代码、不改文件、不建群。',
  `目标：${goal}`,
  `工作文件夹（只读副本）：${repoPath}`,
  handoff === null ? '' : `已经确认的交接单：\n${handoffGoalText(handoff)}`,
  handoff === null ? '' : '交接单已经由人确认；不要再生成目标对齐/确认阶段，直接按主题、共识、约束、待办拆步骤。',
  '先看仓库事实（README、package.json、测试命令、目录结构）。默认三位成员：规划师、执行官、验收员。',
  '- members 默认输出三个：一个 lead、一个 worker、一个 verifier。只有工作能清晰拆成互不冲突的两块、确实需要并行时，才输出两个 worker；此时 orchestration 必须是 parallel。不要输出单人房或其它角色。',
  '- members[].role 只能写 lead / worker / verifier，不要写 planner / executor / reviewer。',
  '- 名字由角色决定：规划师、执行官、验收员；members 里不用另起名字，reason 说明各成员负责什么。',
  '- why 只写一句话、不超过 45 字：默认写三人如何分工；parallel 时说明两块工作如何并行。不要复述目标，也不要加总结句。',
  '- 验收优先用仓库里真实可跑的命令；只写一条短命令（如 `npm test`、`test -f hello.txt`），不要内联多行脚本；命令太长或不可靠就设为 manual。命令要能检验目标本身，不要只检查文件是否存在。',
  '- 只问真正要人拍板、且无法从目标、工作文件夹、交接单或仓库事实中得到答案的问题；不要问“哪个文件/目录、什么技术栈、怎么跑测试”这类已给出的事实；最多 3 个；没有就空数组。',
  '- 每个问题给 2–4 个选项，每个选项写一句代价；推荐选项只能有一个。选项是给人选的方向，不是开放式填空题。',
  '- done 写 1–6 条可核对的完成条件，不要写口号。',
  '- stages 由你按任务自己拆：简单任务 1 步就够，复杂的拆到 5 步；不要为了好看硬拆。每个交付阶段必须有一条可执行验收命令，决策阶段写 kind=decision。',
  '- orchestration 只能写 pipeline / parallel / critique；默认 pipeline。parallel 必须有两个执行成员，只用于可并行的阶段；critique 不增加成员，用于关键交付，让验收成员主动找反例。',
  '- stages[].assignees 只写执行成员（id 或名字，通常是「执行官」）；parallel 阶段写两个执行成员，其它阶段写一个。不要写验收员，验收由系统按独立性规则派发。',
  '- 方案就是对齐与确认。不要生成第一个只重复“确认/对齐”的 decision 阶段；只有执行中真正需要人拍板的分叉才写 decision。',
  '- JSON 代码块必须完整闭合。',
  '先用两句人话把你的计划说给屋里的人听（分几步、谁做、怎么算完成），然后只输出一个 JSON 代码块给系统建步骤；JSON 之外只许有这段计划，不要寒暄，不要小标题。',
  '```json',
  '{',
  '  "done": ["可核对的完成条件"],',
  '  "questions": [',
  '    {"text": "真正要人拍板的问题", "options": [{"label": "选项 A", "cost": "快，但不彻底"}, {"label": "选项 B", "cost": "慢，但更稳"}], "recommendation": "选项 A"}',
  '  ],',
  '  "members": [',
  '    {"role": "lead", "reason": "对齐目标与阶段"},',
  '    {"role": "worker", "reason": "实现与跑测试"},',
  '    {"role": "verifier", "reason": "独立复核证据"}',
  '  ],',
  '  "orchestration": "pipeline",',
  '  "stages": [',
  '    {"title": "实现", "kind": "deliverable", "acceptance": "npm test", "assignees": ["执行官"]}',
  '  ],',
  '  "verify": "test",',
  '  "acceptance": "在仓库根目录可执行的验收命令",',
  '  "why": "一句话说明为什么是这个编制"',
  '}',
  '```',
].join('\n')

// 规划师在 JSON 之外说的话也是它说的：保留下来，作为房间里的第一条计划消息。
const proseFromReply = reply => {
  const text = String(reply ?? '')
  const fenced = text.match(/```(?:json)?\s*[\s\S]*?```/i)
  const prose = fenced === null ? text.split('{')[0] : text.replace(fenced[0], '')
  return prose.trim().slice(0, 2000)
}

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

// 模型偶尔把换行或制表符直接写进字符串，也会在末尾留逗号；这些是格式噪声，
// 不该让整张方案作废，解析前先修一遍。
const repairJson = text => {
  let out = ''
  let inString = false
  let escaped = false
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]
    if (inString) {
      if (escaped) {
        out += char
        escaped = false
        continue
      }
      if (char === '\\') {
        out += char
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
        out += char
        continue
      }
      if (char === '\n') {
        out += '\\n'
        continue
      }
      if (char === '\r') continue
      if (char === '\t') {
        out += '\\t'
        continue
      }
      if (char < ' ') continue
      out += char
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === ',') {
      let ahead = at + 1
      while (ahead < text.length && /\s/.test(text[ahead])) ahead += 1
      if (text[ahead] === '}' || text[ahead] === ']') continue
    }
    out += char
  }
  return out
}

// 模型只给语义建议；权限、成员上限与验收方式仍在这里由业务规则校验。
export const parseProposal = reply => {
  const json = extractJsonBlock(reply)
  if (json === null) throw new Error('Lodge 没有给出可用的方案，请重试')
  let data
  try {
    data = JSON.parse(repairJson(json))
  } catch {
    throw new Error('Lodge 给出的方案格式不完整，请重试')
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.members)) {
    throw new Error('开工方案缺少 members')
  }
  const done = Array.isArray(data.done)
    ? data.done
      .filter(item => typeof item === 'string' && item.trim() !== '')
      .map(item => item.trim().slice(0, 200))
      .slice(0, 6)
    : []
  if (done.length === 0) throw new Error('开工方案里没有可核对的结果')
  const tooManyDone = Array.isArray(data.done) && data.done.length > 6
  const questions = Array.isArray(data.questions)
    ? data.questions
      .map(item => ({
        text: typeof item?.text === 'string' ? item.text.trim().slice(0, 300) : '',
        options: Array.isArray(item?.options)
          ? item.options
            .map(option => ({
              label: typeof option?.label === 'string' ? option.label.trim().slice(0, 160) : '',
              cost: typeof option?.cost === 'string' ? option.cost.trim().slice(0, 240) : '',
            }))
            .filter(option => option.label !== '')
            .slice(0, 4)
          : [],
        recommendation: typeof item?.recommendation === 'string' ? item.recommendation.trim().slice(0, 300) : '',
      }))
      .filter(item => item.text !== '')
      .slice(0, 3)
      .map(item => ({ ...item, recommendation: item.recommendation === '' ? '按推荐' : item.recommendation }))
    : []
  const tooManyQuestions = Array.isArray(data.questions) && data.questions.length > 3

  const entries = data.members.map((member, index) => {
    const role = normalizeRole(member?.role)
    if (role === null) {
      throw new Error(`第 ${index + 1} 个成员角色不合法：${String(member?.role ?? '空')}`)
    }
    const reason = typeof member.reason === 'string' ? member.reason.trim().slice(0, 160) : ''
    return { role, reason }
  })

  let roster
  try {
    roster = rosterFromRoles(entries.map(({ role, name }) => ({ role, name })))
    validateRoster(roster)
  } catch (error) {
    throw new Error(`编制不可用：${error?.message ?? error}`)
  }
  const verifiers = roleMembers(roster).verifiers
  const workers = roleMembers(roster).workers
  const orchestration = resolveOrchestration(data.orchestration)
  const requestedOrchestration = typeof data.orchestration === 'string' ? data.orchestration.trim() : ''


  const rawAcceptance = typeof data.acceptance === 'string' ? data.acceptance.trim() : ''
  const stages = Array.isArray(data.stages)
    ? data.stages
      .slice(0, 3)
      .map(item => {
        const title = typeof item?.title === 'string' ? item.title.trim().slice(0, 80) : ''
        const kind = item?.kind === 'decision' ? 'decision' : 'deliverable'
        const acceptance = typeof item?.acceptance === 'string' ? item.acceptance.trim().slice(0, 500) : ''
        const assignees = resolveAssigneeTokens(item?.assignees, roster)
        return { title, kind, acceptance, ...(assignees.length > 0 ? { assignees } : {}) }
      })
      .filter(item => item.title !== '' && (item.kind === 'decision' || item.acceptance !== ''))
    : []
  const manual = data.verify === 'manual' || (rawAcceptance === '' && stages.every(stage => stage.kind === 'decision'))
  if (manual && verifiers.length > 0 && stages.every(stage => stage.kind === 'decision')) {
    throw new Error('有验收成员时，得有一条能跑的检查；去掉验收成员，或补一条检查')
  }
  const orchestrationId = orchestration?.id ?? defaultOrchestrationId
  const notes = [
    requestedOrchestration !== '' && orchestration === null ? `不认识的分配方式「${requestedOrchestration}」，按默认顺序执行` : '',
    orchestrationId === 'parallel' && workers.length < 2 ? '并行需要至少两个执行成员；当前按单成员执行' : '',
    data.verify === 'test' && rawAcceptance === '' ? '方案没有给出可执行命令，验收改为你确认' : '',
    tooManyQuestions ? '规划师给了超过 3 个问题，只保留前 3 个' : '',
    tooManyDone ? '规划师给了超过 6 条 done，只保留前 6 条' : '',
  ].filter(Boolean)
  return {
    prose: proseFromReply(reply),
    done,
    questions,
    members: roster.map((member, index) => ({
      role: member.role,
      name: member.name,
      reason: entries[index]?.reason ?? '',
    })),
    stages,
    orchestration: orchestrationId,
    verify: manual ? 'manual' : 'test',
    acceptance: manual ? '' : rawAcceptance,
    why: typeof data.why === 'string' ? data.why.trim().slice(0, 300) : '',
    note: notes.join(' · '),
  }
}

export const recommendRoster = async ({ probe, body, workspace }) => {
  const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
  if (goal === '' || goal.length > MAX_GOAL) return fail('invalid', '目标不能为空，且不超过 2000 字')
  const handoff = normalizeHandoff(body.handoff)
  if (probe.available() !== true) return fail('conflict', '当前版本还不支持编队建议')
  const health = await probe.health()
  if (health.ok !== true) throw new Error('Lodge 服务没有连上，先看看它是否还在运行')

  const requestedRepo = typeof body.repoPath === 'string' ? body.repoPath.trim() : ''
  const generatedRepo = requestedRepo === ''
  const short = randomUUID().slice(0, 8)
  const sourceRepo = generatedRepo ? join(workspace.root(), `roster-${short}`) : resolve(requestedRepo)
  let provider = workspace.default
  if (!generatedRepo) {
    if (!workspace.exists(sourceRepo)) return fail('invalid', '工作文件夹不存在')
    // 建议是只读的；不在用户目录里 git init 或写文件。
    if (!workspace.default.probeSource({ source: sourceRepo }).ok) {
      provider = workspace.byId('direct')
      const probe = provider.probeSource({ source: sourceRepo })
      if (!probe.ok) return fail('invalid', probe.error)
    }
  }
  const scout = rosterFromRoles([{ role: 'lead', name: '规划师' }])[0]
  const prompt = recommendationPrompt(goal, sourceRepo, handoff)
  // 只读克隆是一次性工作区；不弹审批，避免读仓库时卡在 permission 卡上。
  scout.approval = 'auto'

  let workspaces = null
  try {
    workspaces = provider.prepareRoom({ source: sourceRepo, short, members: [scout] })
    await probe.start({
      name: `编队评估${short}`,
      soul: '你是规划师。只做编队判断：先用两句人话说计划，再给一段 JSON 建步骤；不执行工具。',
      description: scout.station,
      approval: scout.approval,
      mcp: scout.mcp,
      roomName: `编队建议 · ${short}`,
      goal,
      bulletin: `目标：${goal}\n仓库：${sourceRepo}${handoff === null ? '' : `\n交接单：\n${handoffGoalText(handoff)}`}`,
      cwd: workspaces.members[scout.id].path,
    })
    const reply = await probe.ask(prompt)
    let proposal
    try {
      proposal = parseProposal(reply)
    } catch (error) {
      console.warn('roster recommendation unparsed:', String(reply).slice(0, 500))
      return fail('invalid', error?.message ?? String(error))
    }
    return ok({ proposal })
  } finally {
    await probe.stop()
    try {
      if (workspaces !== null) provider.cleanupRoom({ source: sourceRepo, workspaces })
    } catch {}
    if (generatedRepo) workspace.remove(sourceRepo)
  }
}
