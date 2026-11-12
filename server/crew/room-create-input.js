import { resolveRoomType } from './room-types/index.js'
import {
  DEFAULT_TEMPLATE_ID,
  roleSeats,
  rosterFromRoles,
  seatsFor,
  TEMPLATES,
  validateRoster,
} from './seats.js'

export const roomBulletin = (goal, verify, acceptance, align) => [
  `目标：${goal}`,
  verify === 'test' ? `验收：${acceptance}` : '验收：人确认，不跑命令',
  align
    ? `阶段：1 目标对齐（人确认）；2 ${verify === 'test' ? '交付（命令验收）' : '确认（人签字）'}`
    : `阶段：1 ${verify === 'test' ? '交付（命令验收）' : '确认（人签字）'}`,
].join('\n')

export const alignmentPrompt = (leadName, goal, verify, acceptance) => [
  `@${leadName} 目标：${goal}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  '先和人对齐：只问真正要人拍板的问题（最多 3 个），每个附推荐答案；不要改代码，不要 @工作席位。',
  '用户确认阶段后，系统会发一条以「阶段已确认」开头的消息；收到之前不要派活。',
].join('\n')

export const directPrompt = (goal, verify, acceptance, singleSeat) => [
  `目标：${goal}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  singleSeat
    ? '这是单人房间：直接在当前工作区完成，不要问问题，不要等人对齐；完成后一句话汇报。'
    : '这个房间没有单独的队长：直接在当前工作区完成，不要问问题，不要等人对齐；完成后一句话汇报。',
  '不要自己 git commit / push，系统会提交候选。',
].join('\n')

// 续做只继承人写的 BRIEF；旧证据、阶段与席位会话都不复制。
export const inheritedPlan = (brief, sourceName) => {
  const done = (brief?.done ?? [])
    .map(item => item.text)
    .filter(text => typeof text === 'string' && text.trim() !== '')
    .map(text => text.trim().slice(0, 200))
    .slice(0, 6)
  if (done.length === 0) return null
  return { done, answers: [], why: `续做自交接记录「${sourceName}」` }
}

export const normalizeRequest = body => {
  const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
  if (goal === '' || goal.length > 2000) return { error: '目标不能为空，且不超过 2000 字' }
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
    return { error: '交付型房间需要一条验收命令' }
  }
  return { goal, roomType, verify, acceptance }
}

export const normalizePlan = ({ body, continueSource, roomFiles }) => {
  let plan = null
  if (body.plan !== undefined && body.plan !== null) {
    const done = Array.isArray(body.plan.done)
      ? body.plan.done
        .filter(item => typeof item === 'string' && item.trim() !== '')
        .map(item => item.trim().slice(0, 200))
        .slice(0, 6)
      : []
    if (done.length === 0) return { error: '开工卡缺少可核对的 done' }
    const plannedStages = []
    if (Array.isArray(body.plan.stages)) {
      if (body.plan.stages.length > 3) return { error: '开工卡最多拆 3 个可交付阶段' }
      for (const [index, item] of body.plan.stages.entries()) {
        const title = typeof item?.title === 'string' ? item.title.trim().slice(0, 80) : ''
        const rawKind = item?.kind === 'decision' ? 'decision' : 'deliverable'
        const stageAcceptance = typeof item?.acceptance === 'string' ? item.acceptance.trim().slice(0, 500) : ''
        const manual = rawKind === 'deliverable' && /^manual$/i.test(stageAcceptance)
        const kind = manual ? 'decision' : rawKind
        if (title === '') return { error: `第 ${index + 1} 个阶段缺少标题` }
        if (kind === 'deliverable' && stageAcceptance === '') {
          return { error: `第 ${index + 1} 个交付阶段缺少验收命令` }
        }
        plannedStages.push({
          title,
          kind,
          ...(manual ? { manual: true } : {}),
          ...(kind === 'deliverable' ? { acceptance: stageAcceptance } : {}),
        })
      }
    }
    if (Array.isArray(body.plan.answers) && body.plan.answers.length > 3) {
      return { error: '开工卡最多 3 个问题；先把不必要的分叉合并或留到执行中再说' }
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
      why: typeof body.plan.why === 'string' ? body.plan.why.trim().slice(0, 300) : '',
    }
  } else if (continueSource !== null) {
    plan = inheritedPlan(roomFiles.readBrief(continueSource), continueSource.name)
  }
  return { plan }
}

export const resolveSeats = (body, roomType) => {
  const requestedSeats = Array.isArray(body.seats)
    ? body.seats
    : roomType.defaultSeats ?? null
  let templateId = typeof body.templateId === 'string' && TEMPLATES[body.templateId]?.seats.length > 0
    ? body.templateId
    : DEFAULT_TEMPLATE_ID
  let roster
  try {
    if (requestedSeats !== null && requestedSeats.length > 0) {
      templateId = 'custom'
      roster = rosterFromRoles(requestedSeats)
    } else {
      roster = seatsFor(templateId)
    }
    validateRoster(roster)
  } catch (error) {
    return { error: `席位组合不可用：${error?.message ?? error}` }
  }
  const { workers, verifiers } = roleSeats(roster)
  const worker = workers[0]
  const explicitLead = roster.find(seat => seat.role === 'lead')
  const lead = explicitLead ?? worker
  return { templateId, roster, workers, verifiers, worker, lead, align: explicitLead !== undefined }
}

export const projectSnapshot = (body, sourceRepo, project) => {
  const explicitProject = typeof body.projectConstraints === 'string'
    ? body.projectConstraints.trim().slice(0, project.maxBytes)
    : ''
  const projectFile = explicitProject === '' && body.includeProjectConstraints === true
    ? project.read(sourceRepo)
    : null
  const projectContent = explicitProject !== '' ? explicitProject : projectFile?.content?.trim() ?? ''
  return { projectFile, projectContent }
}

export const effectiveAcceptanceOf = (acceptance, plan) => acceptance || (plan?.stages ?? [])
  .map(stage => stage.acceptance)
  .filter(Boolean)
  .join('；')
