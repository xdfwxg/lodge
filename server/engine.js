import { createBaseClient } from './base.js'
import { RUNTIME_EVENT } from './crew/runtime-port.js'
import { actionForTool } from '../shared/tool-action.js'

// Engine 适配器：把具体基座翻译成 crew 的 runtime 端口与规范化事件。
// 这是 Lodge 与基座之间唯一的 HTTP/词汇边界。基座冻结：不改基座本体；
// 新能力先加到 crew/runtime-port.js，再由这里适配。以后换自己的 runtime，
// 实现同一份端口并跑同一组契约测试即可。
const normalizeRoom = (group, responderName) => ({
  id: group.id,
  name: group.name,
  sessionRef: group.threadId,
  goal: group.tasks?.[0]?.title ?? group.bulletin ?? group.name ?? '',
  working: group.working === true,
  busyRef: typeof group.busyBotId === 'string' ? group.busyBotId : null,
  queue: Array.isArray(group.queue)
    ? group.queue.map(item => ({
      memberRef: item.botId,
      state: item.state,
      position: item.position,
      of: item.of,
      ...(item.waitingForBotId === undefined ? {} : { waitingForRef: item.waitingForBotId }),
    }))
    : [],
  holds: group.holds ?? {},
  heldMessages: group.heldMessages ?? {},
  tasks: Array.isArray(group.tasks) ? group.tasks : [],
  unread: group.unread === true,
  cwd: typeof group.cwd === 'string' && group.cwd !== ''
    ? group.cwd
    : typeof group.pinnedCwd === 'string' && group.pinnedCwd !== ''
      ? group.pinnedCwd
      : '',
  usage: {
    turns: group.usage?.turns ?? 0,
    costMicroUsd: Math.round((group.usage?.costUsd ?? 0) * 1_000_000),
    ...(Number.isFinite(group.usage?.input) || Number.isFinite(group.usage?.output)
      ? {
          tokens: {
            input: group.usage?.input ?? 0,
            output: group.usage?.output ?? 0,
            cachedInput: group.usage?.cachedInput ?? 0,
          },
        }
      : {}),
  },
})

const normalizeActivity = (label, responderName) => (
  responderName === '' ? label : label.split(`${responderName}'s `).join('').split(responderName).join('执行')
)

// 语义动作的映射在 shared/tool-action.js；适配器只负责协议转换。

const normalizeMessage = (raw, responderName) => {
  if (raw === null || typeof raw !== 'object') return null
  const common = {
    id: raw.id,
    at: raw.at ?? Date.now(),
    authorRef: raw.from?.botId ?? raw.digest?.botId ?? null,
    ...(typeof raw.sendId === 'string' ? { sendId: raw.sendId } : {}),
  }
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
      tool: {
        id: tool.itemId,
        name: tool.name,
        input: tool.input,
        ...(tool.step === undefined || tool.step === null ? {} : { step: tool.step }),
        ...(typeof tool.spoken === 'string' ? { spoken: tool.spoken } : {}),
      },
    }
  }
  if (raw.kind === 'options' || raw.kind === 'question') {
    const card = raw.card ?? {}
    const options = Array.isArray(card.options)
      ? card.options
      : Array.isArray(card.choices) ? card.choices : []
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
            options: options.filter(option => typeof option === 'string'),
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
        at: digest.at ?? raw.at ?? common.at,
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
  if (text === '') return null
  // 一次回答可能拆成几条 text：先一句过场，再给正文。带回回合身份，房间才能只留最后一条。
  return {
    ...common,
    kind: 'text',
    role: 'agent',
    text,
    ...(typeof raw.turnId === 'string' && raw.turnId !== ''
      ? {
        turnId: raw.turnId,
        // 只有 runtime 明确标了收尾才算收尾；不标就按一条完整发言处理，不当成过场。
        ...(typeof raw.turnTerminal === 'boolean' ? { turnFinal: raw.turnTerminal } : {}),
      }
      : {}),
  }
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

  const history = async (sessionRef, { limit = 1000 } = {}) => {
    const page = await client.threadMessages(sessionRef, limit)
    const messages = (page.messages ?? [])
      .map(raw => normalizeMessage(raw, responderNameFor(sessionRef)))
      .filter(message => message !== null)
    return { messages }
  }

  const sendTurn = async ({ roomId, text, sendId, mentions = [] }) => {
    const body = await client.sendGroupMessage(roomId, text, { sendId, mentions })
    return {
      accepted: true,
      messageId: body?.message?.id ?? null,
      sendId: body?.message?.sendId ?? sendId ?? null,
      queued: body?.queued === true,
      queueId: typeof body?.queueId === 'string' ? body.queueId : null,
      threadId: typeof body?.threadId === 'string' ? body.threadId : null,
    }
  }

  const cancelRoomQueue = async (roomId, queueId) => {
    try {
      await client.cancelGroupQueue(roomId, queueId)
      return { cancelled: true }
    } catch (error) {
      const text = String(error?.message ?? error)
      return /base 404/.test(text) ? { cancelled: false, reason: '这条排队消息已经不在队列里' } : { cancelled: false, reason: text }
    }
  }

  // 插话三态：steered 已进入运行中的回合；refused 确定没进；indeterminate 可能已进，不能重发。
  const steerRoomQueue = async (roomId, queueId) => {
    try {
      const body = await client.steerGroupQueue(roomId, queueId)
      if (body?.steered === true) {
        return {
          outcome: 'steered',
          messageIds: Array.isArray(body.messages) ? body.messages.map(message => message.id).filter(Boolean) : [],
          queueIds: Array.isArray(body.queueIds) ? body.queueIds : [],
        }
      }
      if (body?.queued === true) return { outcome: 'refused', reason: '引擎不能插话，消息留在队列' }
      return { outcome: 'indeterminate', reason: '基座没有给出明确结果' }
    } catch (error) {
      const text = String(error?.message ?? error)
      return /base (404|409)/.test(text)
        ? { outcome: 'refused', reason: text }
        : { outcome: 'indeterminate', reason: text }
    }
  }

  const answerCard = async ({ sessionRef, requestId, behavior, message }) => {
    if (typeof sessionRef !== 'string' || typeof requestId !== 'string') throw new Error('卡片缺少线程或请求 id')
    if (!['allow', 'deny', 'answer'].includes(behavior)) throw new Error('卡片只接受 allow、deny 或 answer')
    if (behavior === 'answer' && (typeof message !== 'string' || message.trim() === '')) {
      throw new Error('回答卡片需要一个答案')
    }
    return client.respondToCard(sessionRef, requestId, behavior, message)
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

  // 基座特性开关是数据，不是端口常量；打开技能库后 Lodge 才能挂技能。
  const features = async () => {
    try {
      const config = await client.config()
      return {
        skillsLibrary: config?.features?.skillsLibrary === true,
      }
    } catch {
      return { skillsLibrary: false }
    }
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
    holds: true,
    mcp: true,
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
    throw new Error('还没有可用的模型；先在模型服务里配置一个。')
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
    'pi-cli': 'piAgent',
    pi: 'piAgent',
    'gemini-cli': 'antigravityAgent',
  }

  // 本机用 CLI 自己的 token 配置（例如 Claude Code 指向 DeepSeek 的 anthropic 端点）时，
  // `claude auth status` 仍是 loggedIn:false。显式打开这个开关就把这条 CLI 当成可用；
  // 只对 claude 生效，也只在开发机自己设置时才开。
  const CLI_TOKEN_ENGINES = new Set(['claudeAgent'])
  const acceptCliToken = process.env.LODGE_ACCEPT_CLI_TOKEN === '1'

  const instances = async () => {
    const page = await client.instances()
    return (page?.instances ?? []).map(item => ({
      id: item.instanceId,
      engine: item.driverKind,
      name: item.displayName ?? item.instanceId,
      available: item.snapshot?.state === 'available',
      reason: item.snapshot?.reason ?? '',
      // 基座已经探测过登录；undefined 表示这个驱动没有这项信息。
      authenticated: item.snapshot?.authenticated === true
        ? true
        : acceptCliToken && CLI_TOKEN_ENGINES.has(item.driverKind) ? true : item.snapshot?.authenticated,
      ...(acceptCliToken && CLI_TOKEN_ENGINES.has(item.driverKind) && item.snapshot?.authenticated !== true
        ? { authSource: 'cli-token' }
        : {}),
      models: item.models ?? { default: '', options: [] },
      capabilities: item.capabilities ?? {},
      login: item.login ?? null,
    }))
  }

  // 成员声明的是引擎类别；绑定到基座可用的具体 instance/model，找不到才显式降级。
  const resolveMemberEngine = async (requested, requestedModel = '') => {
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
    const offered = Array.isArray(instance?.models?.options) ? instance.models.options : []
    const defaultModel = instance?.models?.default || offered[0]?.id || ''
    const explicit = typeof requestedModel === 'string' ? requestedModel.trim() : ''
    const explicitOffered = explicit === '' || explicit === defaultModel || offered.some(option => option?.id === explicit)
    if (instance !== undefined && explicit !== '' && !explicitOffered) {
      return defaultModel === ''
        ? {
          selection: await defaultModelSelection(),
          engine: instance.instanceId,
          requested,
          fallback: true,
          reason: `模型 ${explicit} 不在 ${requested} 的可选列表，且该引擎没有默认模型`,
        }
        : {
          selection: { instanceId: instance.instanceId, model: defaultModel },
          engine: instance.instanceId,
          requested,
          fallback: true,
          reason: `模型 ${explicit} 不在 ${requested} 的可选列表，已回退 ${defaultModel}`,
        }
    }
    const model = explicit || defaultModel
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

  const normalizeToolScope = toolScope => {
    const deny = Array.isArray(toolScope?.deny) ? toolScope.deny : []
    return { deny: [...new Set(['mcp:agents:*', ...deny])] }
  }

  const createMemberBot = async ({ name, soul, description, approval, mcp, roomTools = [], engine, model, toolScope = null }) => {
    const resolved = await resolveMemberEngine(engine, model)
    const selection = resolved.selection
    const servers = [...new Set([
      ...(Array.isArray(mcp) ? mcp.map(grant => grant.server) : []),
      ...(Array.isArray(roomTools) ? roomTools : []),
    ])]
    const settings = {
      ...(typeof soul === 'string' && soul !== '' ? { soul } : {}),
      ...(typeof description === 'string' && description !== '' ? { description } : {}),
      ...(approval === undefined ? {} : { approvalMode: approval }),
      ...(servers.length > 0 ? { mcpServers: servers } : {}),
      // 基座会给每个 bot 自动挂内置 agents MCP；Lodge 的成员只用原生 read/exec/write，
      // 不把 coordinate_bots/session_search 这类团队工具带进房间。
      toolScope: normalizeToolScope(toolScope),
    }
    const created = await client.createBot({ name, modelSelection: selection, settings })
    const bot = created?.bot ?? created
    if (typeof bot?.id !== 'string') throw new Error('基座没有返回 bot')
    return {
      id: bot.id,
      name: bot.name,
      threadId: typeof bot.threadId === 'string' ? bot.threadId : null,
      engine: selection.instanceId,
      model: selection.model,
      requestedEngine: resolved.requested,
      fallback: resolved.fallback,
      reason: resolved.reason,
      capabilities: resolved.capabilities ?? {},
    }
  }

  // 原地换身体：基座支持在同一个 bot/thread 上换模型和设定，历史不用重开。
  // 语义参数留在业务侧，基座字段只在这个适配层出现。
  const patchMemberBot = async (botId, { soul, description, approval, mcp = [], roomTools = [], modelSelection, toolScope = null }) => {
    const servers = [...new Set([
      ...(Array.isArray(mcp) ? mcp.map(grant => grant.server) : []),
      ...(Array.isArray(roomTools) ? roomTools : []),
    ])]
    const body = await client.patchBot(botId, {
      ...(typeof soul === 'string' && soul !== '' ? { soul } : {}),
      ...(typeof description === 'string' && description !== '' ? { description } : {}),
      ...(approval === undefined ? {} : { approvalMode: approval }),
      mcpServers: servers,
      toolScope: normalizeToolScope(toolScope),
      modelSelection,
    })
    const bot = body?.bot ?? body
    return {
      id: bot?.id ?? botId,
      threadId: typeof bot?.threadId === 'string' ? bot.threadId : null,
      engine: bot?.modelSelection?.instanceId ?? null,
      model: bot?.modelSelection?.model ?? null,
    }
  }

  const setBotSkills = async (botId, skills) => {
    const body = await client.setBotSkills(botId, skills)
    return { ok: true, assignedSkills: Array.isArray(body?.assignedSkills) ? body.assignedSkills : skills }
  }

  const updateRoomMembers = async (roomId, members) => {
    await client.patchGroup(roomId, { memberIds: members })
    return { ok: true }
  }

  const markRoomRead = async roomId => {
    await client.patchGroup(roomId, { unread: false })
    return { ok: true }
  }

  const setRoomHold = async (roomId, memberRef, held) => {
    await client.setGroupHold(roomId, memberRef, held)
    return { ok: true }
  }

  // 群聊默认不唤醒任何成员；只有被 @ 的成员才加载。工作室和聊天室都用这一种总线。
  const setRoomMentions = async roomId => {
    await client.patchGroup(roomId, { defaultResponder: { kind: 'mentions' } })
    return { ok: true }
  }

  // 两种房型都由系统点名；成员回复里的 @ 不决定下一棒。
  const createRoom = async ({ name, goal, bulletin, members, cwd, leadId, autoRoute = false, responder, followMentions = false }) => {
    const created = await client.createGroup({ name, memberIds: members })
    const group = created?.group ?? created
    if (typeof group?.id !== 'string' || typeof group?.threadId !== 'string') throw new Error('基座没有返回群')
    try {
      await client.setupGroup(group.id, {
        action: 'complete',
        cwd,
        bulletin: bulletin ?? goal,
        defaultResponder: responder ?? (autoRoute
          ? { kind: 'auto', fallbackBotId: leadId }
          : { kind: 'member', botId: leadId }),
        followMentions,
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

  const deleteMemberBot = async botId => {
    try {
      await client.deleteBot(botId)
    } catch {}
  }

  // 读边界发现越界时，当场叫停这位成员；不是在房间层取消整轮。
  const interruptBot = async (botId, body = {}) => {
    if (typeof botId !== 'string' || botId === '') return { ok: false, error: '没有这个成员' }
    if (typeof client.interruptBot !== 'function') return { ok: false, error: '这个基座不支持叫停成员' }
    return client.interruptBot(botId, body)
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
        if (frame.kind === 'runtime') {
          const event = frame.event
          if (event?.threadId !== sessionRef) return
          if (event.type === 'content.delta' && event.streamKind === 'assistant_text' && typeof event.delta === 'string' && event.delta !== '') {
            onEvent({ type: RUNTIME_EVENT.delta, sessionRef, turnId: event.turnId ?? '', delta: event.delta, at: Date.now() })
          }
          return
        }
        if (frame.kind === 'message' || frame.kind === 'message.patch') {
          if (frame.threadId !== sessionRef) return
          const message = normalizeMessage(frame.message, responderNameFor(sessionRef))
          if (message !== null) onEvent({ type: RUNTIME_EVENT.message, message })
          return
        }
        if (frame.kind === 'group' && frame.group?.id === roomId) {
          onEvent({ type: RUNTIME_EVENT.room, room: normalizeRoom(frame.group, responderNameFor(frame.group.threadId)) })
        }
      },
    })
    return () => controller.abort()
  }

  // 基座 MCP 注册表：Lodge 自己的 Planner 工具面也按外部 MCP server 注册，
  // 只有拿到名字的成员才会加载。
  const mcp = {
    list: () => client.mcpServers(),
    create: payload => client.createMcpServer(payload),
    update: (name, payload) => client.updateMcpServer(name, payload),
    patch: (name, payload) => client.patchMcpServer(name, payload),
    remove: name => client.deleteMcpServer(name),
  }

  return {
    rooms,
    history,
    instances,
    sendTurn,
    steerRoomQueue,
    cancelRoomQueue,
    answerCard,
    cancelTurn,
    capabilities,
    features,
    health,
    createMemberBot,
    patchMemberBot,
    setBotSkills,
    createRoom,
    updateRoomMembers,
    setRoomMentions,
    setRoomHold,
    markRoomRead,
    deleteMemberBot,
    interruptBot,
    deleteRoom,
    subscribe,
    mcp,
  }
}
