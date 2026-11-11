import { createBaseClient } from './base.js'

// Engine 端口：crew 业务层只依赖这里定义的语义，不认识 OpenMausBot。
// 替换 runtime 时实现同样六个方法即可：
//   rooms() -> Room[]
//   history(sessionRef) -> { messages }
//   sendTurn({ roomId, text }) -> { accepted }
//   cancelTurn({ roomId }) -> { cancelled, reason? }
//   usage(roomId) -> { turns, costMicroUsd }
//   subscribe({ roomId, sessionRef, onEvent, onState }) -> unsubscribe
// Room: { id, name, sessionRef, goal, working, cwd, usage }
const normalizeRoom = (group, responderName) => ({
  id: group.id,
  name: group.name,
  sessionRef: group.threadId,
  goal: group.tasks?.[0]?.title ?? group.bulletin ?? group.name ?? '',
  working: group.working === true,
  busyRef: typeof group.busyBotId === 'string' ? group.busyBotId : null,
  cwd: typeof group.cwd === 'string' && group.cwd !== ''
    ? group.cwd
    : typeof group.pinnedCwd === 'string' && group.pinnedCwd !== ''
      ? group.pinnedCwd
      : '',
  usage: {
    turns: group.usage?.turns ?? 0,
    costMicroUsd: Math.round((group.usage?.costUsd ?? 0) * 1_000_000),
  },
})

const normalizeActivity = (label, responderName) => (
  responderName === '' ? label : label.split(`${responderName}'s `).join('').split(responderName).join('执行')
)

// 工具名到语义动作的映射只放在引擎适配层；业务只认识 read/exec/write。
export const actionForTool = tool => {
  const name = String(tool ?? '').toLowerCase()
  if (name === '') return null
  if (/(write|edit|multiedit|notebookedit)/.test(name)) return 'write'
  if (/(bash|shell|exec|command|terminal|kill)/.test(name)) return 'exec'
  if (/(read|grep|glob|ls|list|notebookread)/.test(name)) return 'read'
  return null
}

const normalizeMessage = (raw, responderName) => {
  if (raw === null || typeof raw !== 'object') return null
  const common = { id: raw.id, at: raw.at ?? Date.now(), authorRef: raw.from?.botId ?? raw.digest?.botId ?? null }
  if (raw.role === 'user') {
    const text = typeof raw.text === 'string' ? raw.text : ''
    return text === '' ? null : { ...common, kind: 'text', role: 'user', text }
  }
  if (raw.kind === 'activity') {
    const tool = raw.tool ?? {}
    return {
      ...common,
      kind: 'activity',
      role: 'agent',
      text: normalizeActivity(String(tool.label ?? tool.name ?? '工具调用'), responderName),
      ok: tool.ok !== false,
      turnId: raw.turnId,
      tool: { id: tool.itemId, name: tool.name, input: tool.input },
    }
  }
  if (raw.kind === 'options') {
    const card = raw.card ?? {}
    return {
      ...common,
      kind: 'question',
      role: 'agent',
      text: raw.text ?? '一张提问卡',
      ...(typeof card.requestId === 'string'
        ? {
          card: {
            requestId: card.requestId,
            requestType: card.requestType,
            tool: card.tool,
            action: actionForTool(card.tool),
            subtitle: card.subtitle,
            options: Array.isArray(card.options) ? card.options : [],
          },
        }
        : {}),
    }
  }
  if (raw.kind === 'digest') {
    const digest = raw.digest ?? {}
    return {
      ...common,
      kind: 'turn',
      turn: {
        turnId: digest.turnId,
        durationMs: digest.durationMs,
        reply: digest.reply ?? '',
        toolCalls: digest.toolCalls,
        tools: digest.tools ?? [],
        usage: digest.usage,
        hookCoverage: digest.hookCoverage,
      },
    }
  }
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  return text === '' ? null : { ...common, kind: 'text', role: 'agent', text }
}

export const createEngine = ({ client = createBaseClient() } = {}) => {
  const responderNames = new Map()
  const responderNameFor = sessionRef => responderNames.get(sessionRef) ?? ''

  const rooms = async () => {
    const bootstrap = await client.bootstrap()
    const responders = bootstrap.bots ?? []
    const list = (bootstrap.groups ?? []).map(group => {
      const responderId = group.defaultResponder?.botId ?? group.memberIds?.[0] ?? ''
      const responderName = responders.find(item => item.id === responderId)?.name ?? ''
      if (typeof group.threadId === 'string') responderNames.set(group.threadId, responderName)
      return normalizeRoom(group, responderName)
    })
    return list
  }

  const history = async (sessionRef, { limit = 200 } = {}) => {
    const page = await client.threadMessages(sessionRef, limit)
    const messages = (page.messages ?? [])
      .map(raw => normalizeMessage(raw, responderNameFor(sessionRef)))
      .filter(message => message !== null)
    return { messages }
  }

  const sendTurn = async ({ roomId, text }) => {
    const body = await client.sendGroupMessage(roomId, text)
    return { accepted: true, messageId: body?.message?.id ?? null }
  }

  const answerCard = async ({ sessionRef, requestId, behavior }) => {
    if (typeof sessionRef !== 'string' || typeof requestId !== 'string') throw new Error('权限卡缺少线程或请求 id')
    if (!['allow', 'deny'].includes(behavior)) throw new Error('权限卡只接受 allow/deny')
    return client.respondToCard(sessionRef, requestId, behavior)
  }

  // Stop 走基座的 interrupt；没有正在跑的回合就如实报告。
  const cancelTurn = async ({ roomId } = {}) => {
    try {
      const list = await rooms()
      const room = list.find(item => item.id === roomId)
      if (room?.busyRef === undefined || room.busyRef === null) {
        return { cancelled: false, reason: '当前没有正在跑的回合' }
      }
      await client.interruptBot(room.busyRef, { threadId: room.sessionRef })
      return { cancelled: true }
    } catch (error) {
      return { cancelled: false, reason: String(error?.message ?? error) }
    }
  }

  const usage = async roomId => {
    const list = await rooms()
    return list.find(room => room.id === roomId)?.usage ?? { turns: 0, costMicroUsd: 0 }
  }

  const capabilities = () => ({
    resume: false,
    streaming: true,
    approvals: true,
    structuredOutput: true,
    subagents: false,
    cancel: true,
    provisioning: true,
    mentions: true,
    mcp: true,
    // 适配层还没有安装技能的路径；技能引用可以先存，但建房时 fail closed。
    skills: false,
    // 定时/事件触发归基座 routines/webhooks；适配层尚未接线。
    schedules: false,
  })

  const health = async () => {
    try {
      const bootstrap = await client.bootstrap()
      return { ok: true, rooms: (bootstrap.groups ?? []).length }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  const defaultModelSelection = async () => {
    const bootstrap = await client.bootstrap()
    const bot = (bootstrap.bots ?? []).find(item => item.hidden !== true && item.modelSelection)
    if (bot?.modelSelection) return bot.modelSelection
    if (process.env.CREW_MODEL_INSTANCE && process.env.CREW_MODEL) {
      return { instanceId: process.env.CREW_MODEL_INSTANCE, model: process.env.CREW_MODEL }
    }
    throw new Error('基座里没有可复用的引擎模型；先在基座里建一个 bot')
  }

  const ENGINE_ALIASES = {
    'claude-cli': 'claudeAgent',
    claude: 'claudeAgent',
    'codex-cli': 'codex',
    codex: 'codex',
    'grok-cli': 'grokAgent',
    grok: 'grokAgent',
    'kimi-cli': 'kimiAgent',
    'qwen-cli': 'qwenAgent',
    'deepseek-cli': 'deepseekAgent',
    'gemini-cli': 'antigravityAgent',
  }

  const instances = async () => {
    const page = await client.instances()
    return (page?.instances ?? []).map(item => ({
      id: item.instanceId,
      engine: item.driverKind,
      name: item.displayName ?? item.instanceId,
      available: item.snapshot?.state === 'available',
      reason: item.snapshot?.reason ?? '',
      models: item.models ?? { default: '', options: [] },
      capabilities: item.capabilities ?? {},
    }))
  }

  // 席位声明的是引擎类别；绑定到基座可用的具体 instance/model，找不到才显式降级。
  const resolveSeatEngine = async requested => {
    if (typeof requested !== 'string' || requested === '') {
      const selection = await defaultModelSelection()
      return { selection, engine: selection.instanceId, requested: '', fallback: false, reason: '' }
    }
    const wanted = ENGINE_ALIASES[requested] ?? requested
    let list = []
    try {
      list = (await client.instances())?.instances ?? []
    } catch {
      list = []
    }
    const instance = list.find(item => (
      item?.snapshot?.state === 'available' &&
      (item.instanceId === requested || item.driverKind === wanted)
    ))
    const model = instance?.models?.default || instance?.models?.options?.[0]?.id || ''
    if (instance !== undefined && typeof model === 'string' && model !== '') {
      return {
        selection: { instanceId: instance.instanceId, model },
        engine: instance.instanceId,
        requested,
        fallback: false,
        reason: '',
        capabilities: instance.capabilities ?? {},
      }
    }
    const selection = await defaultModelSelection()
    const unavailable = list.find(item => item.instanceId === requested || item.driverKind === wanted)
    const detail = typeof unavailable?.snapshot?.reason === 'string' ? unavailable.snapshot.reason.trim() : ''
    return {
      selection,
      engine: selection.instanceId,
      requested,
      fallback: true,
      reason: detail === '' ? `${requested} 不可用` : `${requested} 不可用：${detail.slice(0, 180)}`,
    }
  }

  const createSeatBot = async ({ name, soul, description, approval, mcp, engine }) => {
    const resolved = await resolveSeatEngine(engine)
    const selection = resolved.selection
    const settings = {
      ...(typeof soul === 'string' && soul !== '' ? { soul } : {}),
      ...(typeof description === 'string' && description !== '' ? { description } : {}),
      ...(approval === undefined ? {} : { approvalMode: approval }),
      ...(Array.isArray(mcp) && mcp.length > 0
        ? { mcpServers: [...new Set(mcp.map(grant => grant.server))] }
        : {}),
    }
    const created = await client.createBot({ name, modelSelection: selection, settings })
    const bot = created?.bot ?? created
    if (typeof bot?.id !== 'string') throw new Error('基座没有返回 bot')
    return {
      id: bot.id,
      name: bot.name,
      engine: selection.instanceId,
      model: selection.model,
      requestedEngine: resolved.requested,
      fallback: resolved.fallback,
      reason: resolved.reason,
      capabilities: resolved.capabilities ?? {},
    }
  }

  const createRoom = async ({ name, goal, bulletin, members, cwd, leadId }) => {
    const created = await client.createGroup({ name, memberIds: members })
    const group = created?.group ?? created
    if (typeof group?.id !== 'string' || typeof group?.threadId !== 'string') throw new Error('基座没有返回群')
    try {
      await client.setupGroup(group.id, {
        action: 'complete',
        cwd,
        bulletin: bulletin ?? goal,
        defaultResponder: { kind: 'member', botId: leadId },
      })
      await client.patchGroupTask(group.id, group.threadId, { title: goal })
    } catch (error) {
      try {
        await client.deleteGroup(group.id)
      } catch {}
      throw error
    }
    return { id: group.id, sessionRef: group.threadId }
  }

  const deleteSeatBot = async botId => {
    try {
      await client.deleteBot(botId)
    } catch {}
  }

  const deleteRoom = async roomId => {
    try {
      await client.deleteGroup(roomId)
    } catch {}
  }

  const subscribe = ({ roomId, sessionRef, onEvent = () => {}, onState = () => {} }) => {
    const controller = new AbortController()
    void client.watchEvents({
      signal: controller.signal,
      onState,
      onFrame: frame => {
        if (frame.kind === 'message' || frame.kind === 'message.patch') {
          if (frame.threadId !== sessionRef) return
          const message = normalizeMessage(frame.message, responderNameFor(sessionRef))
          if (message !== null) onEvent({ type: 'message', message })
          return
        }
        if (frame.kind === 'group' && frame.group?.id === roomId) {
          onEvent({ type: 'room', room: normalizeRoom(frame.group, responderNameFor(frame.group.threadId)) })
        }
      },
    })
    return () => controller.abort()
  }

  return {
    rooms,
    history,
    instances,
    sendTurn,
    answerCard,
    cancelTurn,
    usage,
    capabilities,
    health,
    createSeatBot,
    createRoom,
    deleteSeatBot,
    deleteRoom,
    subscribe,
  }
}
