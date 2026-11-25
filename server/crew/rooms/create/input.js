import { roomModeForType } from '../kinds.js'
import { resolveOrchestration } from '../../orchestration/index.js'
import { resolveRoomType } from '../kinds.js'
import { normalizeHandoffBrief } from '../../../../shared/handoff-brief.js'
import { normalizeContract } from '../../../../shared/contract.js'
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
  const requested = Array.isArray(body.members) ? body.members : []
  const hasMembers = requested.length > 0
  const hasPlan = body.plan !== undefined && body.plan !== null
  // 只带规划师也算启动态；探针和定制规划师模型走这条路，不算组队完成。
  const onlyPlanner = hasMembers && requested.every(member => member?.role === 'lead')
  const bootstrap = isStudio && !hasPlan && (!hasMembers || onlyPlanner)
  const shadowReview = body.shadowReview === true
  const autoDeliver = isStudio && body.autoDeliver === true
  // 编排归系统：按工作包的独立程度决定；建房请求里带了就走拒绝，不静默忽略。
  if (body.orchestration !== undefined || body.plan?.orchestration !== undefined) {
    return { error: '编排方式由系统按工作包决定，建房时不能指定' }
  }
  const orchestration = resolveOrchestration(null)
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
    const contract = normalizeContract(body.plan.contract)
    // 有契约时 done 是契约的投影，不再读第二份 done。
    const done = contract === null
      ? (Array.isArray(body.plan.done)
        ? body.plan.done
          .filter(item => typeof item === 'string' && item.trim() !== '')
          .map(item => item.trim().slice(0, 200))
          .slice(0, 6)
        : [])
      : contract.outcomes.map(item => item.statement)
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
        // 执行者由系统按工作包和执行官人数分配，计划里不能指定。
        if (item?.assignees !== undefined) {
          return { error: `第 ${index + 1} 步不能指定执行者：系统按工作包分配` }
        }
        const clauseIds = Array.isArray(item?.clauseIds)
          ? item.clauseIds
            .filter(id => typeof id === 'string' && id.trim() !== '')
            .map(id => id.trim().slice(0, 40))
            .slice(0, 6)
          : []
        plannedStages.push({
          title,
          deliverable,
          ...(contract !== null && clauseIds.length === 0 && index === 0
            ? { clauseIds: contract.outcomes.map(outcome => outcome.id) }
            : clauseIds.length === 0 ? {} : { clauseIds }),
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
      ...(contract === null ? {} : { contract }),
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
      const requestedLead = Array.isArray(body.members)
        ? body.members.find(member => member?.role === 'lead')
        : null
      roster = requestedLead === undefined || requestedLead === null
        ? membersFor(templateId).filter(member => member.role === 'lead')
        : rosterFromRoles([requestedLead])
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
