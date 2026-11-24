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
        const deliverable = typeof item?.deliverable === 'string'
          ? stripAttachmentTags(item.deliverable).trim().slice(0, 500)
          : ''
        if (title === '') return { error: `第 ${index + 1} 步缺少名字` }
        if (deliverable === '') return { error: `第 ${index + 1} 步缺少交付物：写清做完会得到什么` }
        plannedStages.push({
          title,
          deliverable,
          ...(Array.isArray(item?.assignees) ? { assignees: item.assignees } : {}),
          ...(Array.isArray(item?.packages)
            ? {
              packages: item.packages
                .filter(pkg => typeof pkg?.title === 'string' && pkg.title.trim() !== '')
                .slice(0, 4)
                .map(pkg => ({
                  title: pkg.title.trim().slice(0, 80),
                  files: (Array.isArray(pkg.files) ? pkg.files : [])
                    .filter(file => typeof file === 'string' && file.trim() !== '')
                    .slice(0, 12)
                    .map(file => file.trim().slice(0, 200)),
                })),
            }
            : {}),
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
