import { roomModeForType } from '../kinds.js'
import { resolveOrchestration } from '../../orchestration/index.js'
import { resolveRoomType } from '../kinds.js'
import { normalizeHandoffBrief } from '../../../../shared/handoff-brief.js'
import { normalizeReceipt } from '../../../../shared/receipt.js'
import { stripAttachmentTags } from '../../../../shared/attachments.js'
import {
  DEFAULT_TEMPLATE_ID,
  roleMembers,
  rosterFromRoles,
  membersFor,
  TEMPLATES,
  validateRoster,
} from '../../roster.js'

// 阶段检查必须是一条真能跑的命令；“看起来没问题”这类话不能当门。
const RUNNABLE_CHECK = /(^|[\s;&|(])(?:npm|pnpm|yarn|bun|node|npx|deno|python3?|pytest|go|cargo|make|bash|sh|zsh|ruby|bundle|php|java|mvn|gradle|dotnet|swift|curl|git|grep|cat|diff|test|ls|find|jq|sed|awk|tsc|eslint|vitest|jest|playwright)(?:\s|$)/

export const runnableCheck = value => (
  typeof value === 'string' &&
  (value.startsWith('./') || value.startsWith('/') || RUNNABLE_CHECK.test(value))
)

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

const normalizeProject = value => {
  if (value === null || typeof value !== 'object') return null
  const northStar = cleanText(value.northStar, 1000)
  return northStar === '' ? null : { northStar }
}

export const normalizeRequest = body => {
  const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
  if (goal === '' || goal.length > 2000) return { error: '目标不能为空，且不超过 2000 字' }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length > 60) return { error: '房间名称不能超过 60 字' }
  const roomType = resolveRoomType(body.roomType)
  if (roomType === null) return { error: '未知的房间类型' }
  // 工作室不再在建房时选成员：没有成员、没有方案，就先只带规划师开工。
  const isStudio = roomType.id === 'studio'
  const hasMembers = Array.isArray(body.members) && body.members.length > 0
  const hasPlan = body.plan !== undefined && body.plan !== null
  const bootstrap = isStudio && !hasMembers && !hasPlan
  let chatTurnLimit = null
  if (body.chatTurnLimit !== undefined && body.chatTurnLimit !== null) {
    const value = Number(body.chatTurnLimit)
    const max = roomType.maxChatTurns ?? 20
    if (!Number.isInteger(value) || value < 1 || value > max) {
      return { error: `聊天室轮次上限必须是 1–${max} 的整数` }
    }
    chatTurnLimit = value
  }
  const normalized = roomType.normalize({
    body,
    verify: body.verify === 'manual' ? 'manual' : 'test',
    acceptance: typeof body.acceptance === 'string' ? body.acceptance.trim() : '',
  })
  // 启动态还没有交付阶段；检查由规划师在 submit_plan 里给。
  const verify = bootstrap ? 'manual' : normalized.verify
  const acceptance = bootstrap ? '' : (typeof normalized.acceptance === 'string' ? normalized.acceptance.trim() : '')
  const plannedAcceptance = Array.isArray(body.plan?.stages)
    ? body.plan.stages.some(stage => typeof stage?.acceptance === 'string' && stage.acceptance.trim() !== '')
    : false
  if (verify === 'test' && acceptance === '' && !plannedAcceptance) {
    return { error: '要交付的房间需要一条检查' }
  }
  const shadowReview = body.shadowReview === true
  const autoDeliver = isStudio && body.autoDeliver === true
  const orchestration = resolveOrchestration(body.orchestration ?? body.plan?.orchestration)
  if (orchestration === null) return { error: '不认识的分配方式' }
  const handoffBrief = normalizeHandoffBrief(body.handoffBrief)
  const handoffBriefReviewed = body.handoffBriefReviewed === true
  const receipt = normalizeReceipt(body.receipt)
  const sourceRoomId = typeof body.sourceRoomId === 'string' ? body.sourceRoomId.trim().slice(0, 120) : ''
  const sourceName = typeof body.sourceName === 'string' ? body.sourceName.trim().slice(0, 120) : ''
  const project = isStudio ? normalizeProject(body.project) ?? { northStar: goal } : null
  return {
    goal,
    name,
    roomType,
    project,
    verify,
    acceptance,
    orchestration,
    shadowReview,
    autoDeliver,
    chatTurnLimit,
    handoffBrief,
    handoffBriefReviewed,
    receipt,
    sourceRoomId,
    sourceName,
    bootstrap,
  }
}

export const normalizePlan = ({ body }) => {
  let plan = null
  if (body.plan !== undefined && body.plan !== null) {
    const done = Array.isArray(body.plan.done)
      ? body.plan.done
        .filter(item => typeof item === 'string' && item.trim() !== '')
        .map(item => item.trim().slice(0, 200))
        .slice(0, 6)
      : []
    if (done.length === 0) return { error: '方案里没有可核对的结果' }
    const plannedStages = []
    if (Array.isArray(body.plan.stages)) {
      if (body.plan.stages.length > 3) return { error: '方案最多拆成 3 步' }
      for (const [index, item] of body.plan.stages.entries()) {
        const title = typeof item?.title === 'string' ? stripAttachmentTags(item.title).trim().slice(0, 80) : ''
        const rawKind = item?.kind === 'decision' ? 'decision' : 'deliverable'
        const stageAcceptance = typeof item?.acceptance === 'string' ? item.acceptance.trim().slice(0, 500) : ''
        const manual = rawKind === 'deliverable' && /^manual$/i.test(stageAcceptance)
        const kind = manual ? 'decision' : rawKind
        if (title === '') return { error: `第 ${index + 1} 步缺少名字` }
        if (kind === 'deliverable' && stageAcceptance === '') {
          return { error: `第 ${index + 1} 步缺少检查` }
        }
        if (kind === 'deliverable' && !runnableCheck(stageAcceptance)) {
          return { error: `第 ${index + 1} 步的检查不是一条能跑的命令；写清楚跑什么，例如 npm test` }
        }
        plannedStages.push({
          title,
          kind,
          ...(manual ? { manual: true } : {}),
          ...(kind === 'deliverable' ? { acceptance: stageAcceptance } : {}),
          ...(Array.isArray(item?.assignees) ? { assignees: item.assignees } : {}),
        })
      }
    }
    if (Array.isArray(body.plan.answers) && body.plan.answers.length > 3) {
      return { error: '方案最多 3 个问题；先把不必要的分叉合并或留到后面再说' }
    }
    const answers = Array.isArray(body.plan.answers)
      ? body.plan.answers
        .filter(item => typeof item?.question === 'string' && item.question.trim() !== '' && typeof item?.answer === 'string')
        .map(item => ({ question: item.question.trim().slice(0, 300), answer: item.answer.trim().slice(0, 300) }))
        .slice(0, 3)
      : []
    plan = {
      done,
      answers,
      stages: plannedStages,
      ...(typeof body.plan.prose === 'string' && body.plan.prose.trim() !== ''
        ? { prose: body.plan.prose.trim().slice(0, 2000) }
        : {}),
      why: typeof body.plan.why === 'string' ? body.plan.why.trim().slice(0, 300) : '',
    }
  }
  return { plan }
}


export const resolveMembers = (body, roomType, { bootstrap = false } = {}) => {
  const requestedMembers = Array.isArray(body.members)
    ? body.members
    : roomType.defaultMembers ?? null
  let templateId = typeof body.templateId === 'string' && TEMPLATES[body.templateId]?.members.length > 0
    ? body.templateId
    : DEFAULT_TEMPLATE_ID
  let roster
  try {
    if (bootstrap) {
      roster = membersFor(templateId).filter(member => member.role === 'lead')
    } else if (requestedMembers !== null && requestedMembers.length > 0) {
      templateId = 'custom'
      roster = rosterFromRoles(requestedMembers)
    } else {
      roster = membersFor(templateId)
    }
    validateRoster(roster, { requireWorker: roomType.requireWorker !== false && !bootstrap })
  } catch (error) {
    return { error: `成员组合不可用：${error?.message ?? error}` }
  }
  // 只读房型的工具调用必须经过审批桥，讨论阶段才能在实际工具面拒绝写入与执行。
  if (roomType.readOnly === true) roster = roster.map(member => ({ ...member, approval: 'ask' }))
  const mode = roomModeForType(roomType.id)
  roster = roster.map(member => ({ ...member, ...mode.memberRole(member) }))
  const { workers, verifiers } = roleMembers(roster)
  const worker = workers[0] ?? roster[0]
  const explicitLead = roster.find(member => member.role === 'lead')
  const lead = explicitLead ?? worker
  return { templateId, roster, workers, verifiers, worker, lead, align: explicitLead !== undefined, bootstrap }
}

export const effectiveAcceptanceOf = (acceptance, plan) => acceptance || (plan?.stages ?? [])
  .map(stage => stage.acceptance)
  .filter(Boolean)
  .join('；')
