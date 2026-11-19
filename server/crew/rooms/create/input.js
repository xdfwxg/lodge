import { MAX_CHAT_TURNS_PER_ROUND } from '../../room-types/chat.js'
import { roomModeForType } from '../kinds.js'
import { resolveOrchestration } from '../../orchestration/index.js'
import { resolveRoomType } from '../../room-types/index.js'
import { handoffGoalText, normalizeHandoff } from '../../../../shared/handoff.js'
import { normalizeReceipt } from '../../../../shared/receipt.js'
import {
  DEFAULT_TEMPLATE_ID,
  roleMembers,
  rosterFromRoles,
  membersFor,
  TEMPLATES,
  validateRoster,
} from '../../roster.js'

const handoffSection = handoff => {
  const text = handoffGoalText(handoff)
  return text === '' ? '' : `\n交接单：\n${text}`
}

export const alignmentPrompt = (goal, verify, acceptance, handoff = null) => [
  `目标：${goal}${handoffSection(handoff)}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  '口径可能影响结果时，先用一句话把你采用的口径写死；仍然不确定就只问用户一个具体问题，不要默认留空。',
  '用户确认阶段后，系统会发一条以「阶段已确认」开头的消息；收到这条消息后只派当前阶段。',
].join('\n')

export const directPrompt = (goal, verify, acceptance, singleMember, handoff = null) => [
  `目标：${goal}${handoffSection(handoff)}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  '口径可能影响结果时，先用一句话把你采用的口径写死；仍然不确定就只问用户一个具体问题，不要默认留空。',
  singleMember
    ? '这是单人房间：直接在当前工作区完成，不要等人对齐。'
    : '这个房间没有单独的队长：直接在当前工作区完成，不要等人对齐。',
].join('\n')

export const normalizeRequest = body => {
  const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
  if (goal === '' || goal.length > 2000) return { error: '目标不能为空，且不超过 2000 字' }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length > 60) return { error: '房间名称不能超过 60 字' }
  let chatTurnLimit = null
  if (body.chatTurnLimit !== undefined && body.chatTurnLimit !== null) {
    const value = Number(body.chatTurnLimit)
    if (!Number.isInteger(value) || value < 1 || value > MAX_CHAT_TURNS_PER_ROUND) {
      return { error: `聊天室轮次上限必须是 1–${MAX_CHAT_TURNS_PER_ROUND} 的整数` }
    }
    chatTurnLimit = value
  }
  const roomType = resolveRoomType(body.roomType)
  if (roomType === null) return { error: '未知的房间类型' }
  const normalized = roomType.normalize({
    body,
    verify: body.verify === 'manual' ? 'manual' : 'test',
    acceptance: typeof body.acceptance === 'string' ? body.acceptance.trim() : '',
  })
  const verify = normalized.verify
  const acceptance = typeof normalized.acceptance === 'string' ? normalized.acceptance.trim() : ''
  const plannedAcceptance = Array.isArray(body.plan?.stages)
    ? body.plan.stages.some(stage => typeof stage?.acceptance === 'string' && stage.acceptance.trim() !== '')
    : false
  if (verify === 'test' && acceptance === '' && !plannedAcceptance) {
    return { error: '要交付的房间需要一条检查' }
  }
  const shadowReview = body.shadowReview === true
  const orchestration = resolveOrchestration(body.orchestration ?? body.plan?.orchestration)
  if (orchestration === null) return { error: '未知的编排策略' }
  const handoff = normalizeHandoff(body.handoff)
  const handoffReviewed = body.handoffReviewed === true
  const receipt = normalizeReceipt(body.receipt)
  const sourceRoomId = typeof body.sourceRoomId === 'string' ? body.sourceRoomId.trim().slice(0, 120) : ''
  const sourceName = typeof body.sourceName === 'string' ? body.sourceName.trim().slice(0, 120) : ''
  return {
    goal,
    name,
    roomType,
    verify,
    acceptance,
    orchestration,
    shadowReview,
    chatTurnLimit,
    handoff,
    handoffReviewed,
    receipt,
    sourceRoomId,
    sourceName,
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
        const title = typeof item?.title === 'string' ? item.title.trim().slice(0, 80) : ''
        const rawKind = item?.kind === 'decision' ? 'decision' : 'deliverable'
        const stageAcceptance = typeof item?.acceptance === 'string' ? item.acceptance.trim().slice(0, 500) : ''
        const manual = rawKind === 'deliverable' && /^manual$/i.test(stageAcceptance)
        const kind = manual ? 'decision' : rawKind
        if (title === '') return { error: `第 ${index + 1} 步缺少名字` }
        if (kind === 'deliverable' && stageAcceptance === '') {
          return { error: `第 ${index + 1} 步缺少检查` }
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


export const resolveMembers = (body, roomType) => {
  const requestedMembers = Array.isArray(body.members)
    ? body.members
    : roomType.defaultMembers ?? null
  let templateId = typeof body.templateId === 'string' && TEMPLATES[body.templateId]?.members.length > 0
    ? body.templateId
    : DEFAULT_TEMPLATE_ID
  let roster
  try {
    if (requestedMembers !== null && requestedMembers.length > 0) {
      templateId = 'custom'
      roster = rosterFromRoles(requestedMembers)
    } else {
      roster = membersFor(templateId)
    }
    validateRoster(roster, { requireWorker: roomType.requireWorker !== false })
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
  return { templateId, roster, workers, verifiers, worker, lead, align: explicitLead !== undefined }
}

const MAX_PROJECT_BYTES = 20_000



export const effectiveAcceptanceOf = (acceptance, plan) => acceptance || (plan?.stages ?? [])
  .map(stage => stage.acceptance)
  .filter(Boolean)
  .join('；')
