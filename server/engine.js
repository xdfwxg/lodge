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
        // 回执是判定工具把完整入参带回来的唯一通道；界面不看它，房间判定要看。
        ...(tool.output === undefined ? {} : { output: tool.output }),
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
        // 终态是基座的事实，Lodge 只读：stopped/failed 的回合不是交付结果。
        ...(typeof digest.stopReason === 'string' && digest.stopReason !== '' ? { stopReason: digest.stopReason } : {}),
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
      // 基座自己的 health 给出能力；旧基座没有这一项，返回空数组，不猜。
      const [bootstrap, base] = await Promise.all([
        client.bootstrap(),
        typeof client.health === 'function' ? client.health().catch(() => null) : null,
      ])
      return {
        ok: true,
        rooms: (bootstrap.groups ?? []).length,
        networkModes: Array.isArray(base?.network_modes) ? base.network_modes : [],
      }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  const defaultModelSelection = async () => {
    const override = process.env.CREW_MODEL_INSTANCE && process.env.CREW_MODEL
      ? { instanceId: process.env.CREW_MODEL_INSTANCE, model: process.env.CREW_MODEL }
      : null
    const bootstrap = await client.bootstrap()
    const bot = (bootstrap.bots ?? []).find(item => item.hidden !== true && item.modelSelection)
    if (override !== null) {
      // 显式设置的运维开关要赢；基座默认 bot 只在没设的时候生效。
      // 两者不一致必须说出来，否则一次对照会静默跑在别的模型上。
      if (bot?.modelSelection
        && (bot.modelSelection.instanceId !== override.instanceId || bot.modelSelection.model !== override.model)) {
        console.warn(`[lodge] CREW_MODEL_INSTANCE 覆盖基座默认模型：${bot.modelSelection.instanceId}/${bot.modelSelection.model} → ${override.instanceId}/${override.model}`)
      }
      return override
    }
    if (bot?.modelSelection) return bot.modelSelection
    throw new Error('还没有可用的模型；先在模型服务里配置一个。')
  }

  const ENGINE_ALIASES = {
    'claude-cli': 'claude',
    claude: 'claude',
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
  const CLI_TOKEN_ENGINES = new Set(['claudeAgent', 'claude'])
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
    // 可选模型为空的 CLI 引擎（例如 claude）用自己配置里的默认模型：空 model 是合法选择，
    // 驱动会省掉 --model，不由 Lodge 猜一个厂商模型名。
    if (instance !== undefined && (model !== '' || offered.length === 0)) {
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

  const createMemberBot = async ({ name, soul, description, approval, cwd = '', mcp, roomTools = [], autoMcpServers = null, engine, model, toolScope = null, nativeTools = null, budget = null, profile = null, limits = null, network = null }) => {
    const resolved = await resolveMemberEngine(engine, model)
    const selection = resolved.selection
    const servers = [...new Set([
      ...(Array.isArray(mcp) ? mcp.map(grant => grant.server) : []),
      ...(Array.isArray(roomTools) ? roomTools : []),
    ])]
    const settings = {
      ...(typeof soul === 'string' && soul !== '' ? { soul } : {}),
      ...(typeof description === 'string' && description !== '' ? { description } : {}),
      // 工作副本跟着成员走：房间群聊可能被几个人共用，不能拿其中一个人的目录当所有人的 cwd。
      ...(typeof cwd === 'string' && cwd !== '' ? { cwd } : {}),
      ...(approval === undefined ? {} : { approvalMode: approval }),
      ...(servers.length > 0 ? { mcpServers: servers } : {}),
      // 基座会给每个 bot 自动挂内置 agents MCP；Lodge 的成员只用原生 read/exec/write，
      // 不把 coordinate_bots/session_search 这类团队工具带进房间。
      toolScope: normalizeToolScope(toolScope),
      // 原生工具面只在支持收窄的驱动上传；别的驱动保持基座默认，不吃未知字段。
      ...(selection.instanceId === 'pi' && Array.isArray(nativeTools) ? { nativeTools } : {}),
      // 工作区已经同意的提供方：这些服务器的工具不再逐条问。
      ...(selection.instanceId === 'pi' && Array.isArray(autoMcpServers) && autoMcpServers.length > 0 ? { autoMcpServers } : {}),
      // 运行时预算同样只给执行它的驱动；数字由产品层声明，基座不猜。
      ...(selection.instanceId === 'pi' && budget !== null && typeof budget === 'object' ? { budget } : {}),
      // 沙箱边界也是产品的声明：档位、上限、网络。只有支持边界的驱动才收这些字段。
      ...(selection.instanceId === 'pi' && typeof profile === 'string' ? { profile } : {}),
      ...(selection.instanceId === 'pi' && limits !== null && typeof limits === 'object' ? { limits } : {}),
      ...(selection.instanceId === 'pi' && typeof network === 'string' ? { network } : {}),
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
  const patchMemberBot = async (botId, { soul, description, approval, mcp = [], roomTools = [], autoMcpServers = null, modelSelection, toolScope = null, nativeTools = null, budget = null, profile = null, limits = null, network = null }) => {
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
      ...(modelSelection?.instanceId === 'pi' && Array.isArray(nativeTools) ? { nativeTools } : {}),
      ...(modelSelection?.instanceId === 'pi' && Array.isArray(autoMcpServers) && autoMcpServers.length > 0 ? { autoMcpServers } : {}),
      ...(modelSelection?.instanceId === 'pi' && budget !== null && typeof budget === 'object' ? { budget } : {}),
      ...(modelSelection?.instanceId === 'pi' && typeof profile === 'string' ? { profile } : {}),
      ...(modelSelection?.instanceId === 'pi' && limits !== null && typeof limits === 'object' ? { limits } : {}),
      ...(modelSelection?.instanceId === 'pi' && typeof network === 'string' ? { network } : {}),
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

  // strict 给“删房/删成员”这类要担保结果的路径用：404 视为已经不在了，其他错误照实抛出。
  const deleteMemberBot = async (botId, { strict = false } = {}) => {
    try {
      await client.deleteBot(botId)
    } catch (error) {
      if (strict === true && !/base 404 /.test(String(error?.message ?? ''))) throw error
    }
  }

  // 读边界发现越界时，当场叫停这位成员；不是在房间层取消整轮。
  const interruptBot = async (botId, body = {}) => {
    if (typeof botId !== 'string' || botId === '') return { ok: false, error: '没有这个成员' }
    if (typeof client.interruptBot !== 'function') return { ok: false, error: '这个基座不支持叫停成员' }
    return client.interruptBot(botId, body)
  }

  const deleteRoom = async (roomId, { strict = false } = {}) => {
    try {
      await client.deleteGroup(roomId)
    } catch (error) {
      if (strict === true && !/base 404 /.test(String(error?.message ?? ''))) throw error
    }
  }

  // sessionRefs：成员的私有房间线程（盲评、并行派发）。这些线程只该把权限卡和回合结果送进来，
  // 文字仍留在私有线程里，不投进房间时间线。
  const subscribe = ({ roomId, sessionRef, sessionRefs = [], onEvent = () => {}, onState = () => {} }) => {
    const privateRefs = new Set(sessionRefs.filter(ref => typeof ref === 'string' && ref !== '' && ref !== sessionRef))
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
          const isPrivate = privateRefs.has(frame.threadId)
          if (!isPrivate && frame.threadId !== sessionRef) return
          const message = normalizeMessage(frame.message, responderNameFor(frame.threadId))
          if (message !== null) {
            // 私有线程要带上它自己的线程号：权限卡必须在收到它的那条线程上回答。
          onEvent({ type: RUNTIME_EVENT.message, message, ...(isPrivate ? { private: true, sessionRef: frame.threadId } : {}) })
          }
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
