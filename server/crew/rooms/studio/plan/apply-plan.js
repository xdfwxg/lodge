import { STAGE_STATE } from '../../../../../shared/states.js'
import { engineReady } from '../../../../../shared/engine-readiness.js'
import { executorsNeeded, pathsOf, writesPath } from '../../../../../shared/crew-proposal.js'
import { buildStages } from '../../../room-types/studio.js'
import { workspaceOf } from '../runtime/workspace.js'
import { systemNotice } from '../../../notices.js'
import { leadMemberOf } from '../../../room-members.js'
import { memberDisplayName } from '../../../member-labels.js'
import { isProtectedPath } from '../../../protected-files.js'
import { verifierPoolIssue } from '../../../../../shared/verifier-pool.js'
import { readVerifierPool } from '../../../verifier-pool.js'
import { COMMAND_BY, commandRefusal } from '../../../../../shared/studio-commands.js'

// 退回是平台在教规划师改：给三次机会再停下来问人。三次都改不对，说明不是措辞问题。
const rejectionLimit = 3

// 目标里点名的文件（带扩展名，或带目录）必须在某个工作包里：包就是写边界，
// 漏掉的文件会在回合结束时被当成越界退回，交付永远差一块。
// 路径词的取法和方案校验共用一份（`shared/crew-proposal.js` 的 `pathsOf`）。
const goalFileOf = value => String(value).trim().replace(/^\.\//, '').replace(/[.,。；;]+$/u, '')
export const goalPathsOf = goal => pathsOf(goal)

// 规划师提交的方案与队伍：先校验策略，再开通成员，最后把阶段接上并派第一步。
// 任何一步失败都不半建：已经开出来的成员撤掉，对齐继续等下一版。
export const createPlanApplier = ({ store, engine, live, emit, memberAdd, memberRemove, sendToMember = null, verifierPool = undefined }) => {
  const applying = new Set()
  const apply = async (roomId, result) => {
  const room = store.readRoom(roomId)
  if (room === null || room.roomType !== 'studio') return
  if (room.workRound?.plan !== null && room.workRound?.plan !== undefined) {
    // 一轮只组一次队。再提交方案不能悄悄丢掉：说清楚它没生效，并告诉规划师改路。
    const recent = (store.readMessages(roomId) ?? []).slice(-20)
    const told = recent.some(message => message?.kind === 'system'
      && String(message.text ?? '').includes('这一轮的方案已经定过'))
    if (told) return
    const text = '这一轮的方案已经定过；新提交的方案没有生效。要改这一步就退回它，或交给人决定重做。'
    store.appendMessage(roomId, { kind: 'system', text })
    const lead = leadMemberOf(room)
    if (lead !== null && typeof sendToMember === 'function') {
      void sendToMember(
        roomId,
        lead.id,
        '这一轮的方案已经定过，新方案没有生效。要改这一步就调用 rewind 退回，或交给人决定重做；不要再用 submit_plan。',
      ).catch(() => {})
    }
    return
  }
  const reject = async (message) => {
    const current = store.readRoom(roomId) ?? room
    const round = current.workRound ?? {}
    const count = Number(round.planRejections ?? 0) + 1
    store.updateRound(roomId, now => {
      now.planRejections = count
      return { events: [{ type: 'plan.rejected', payload: { count, message } }] }
    })
    const lead = leadMemberOf(current)
    const clean = String(message).replace(/[。．.]+$/u, '')
    if (count < rejectionLimit && lead !== null && typeof sendToMember === 'function') {
      void sendToMember(roomId, lead.id, `队伍或方案还不合规：${clean}。改一版，再用 submit_plan 提交。`).catch(() => {})
      return
    }
    systemNotice({
      store,
      roomId,
      text: `组队没有通过：${clean}。这一轮先停在这里，等你看；你可以直接告诉规划师怎么改，它会再提交一版。`,
    })
    // 话说“等你看”，就要有一个看得见、回得了的入口：问题卡会拦住规划师再提交，
    // 用户回复时解除它并把话送到规划师手里，等于重新给一次组队机会。
    // openQuestion 是轮次字段，只能走 updateRound（用 updateRoom 写会被守卫拒绝）。
    const waiting = store.updateRound(roomId, current => {
      if (typeof current.openQuestion === 'string' && current.openQuestion.trim() !== '') return null
      current.openQuestion = '方案还没通过：告诉规划师怎么改。'
      return { events: [{ type: 'question.asked', payload: { text: current.openQuestion } }] }
    })
    if (waiting !== null) emit?.('room', waiting)
  }

  if (result?.proposal === undefined) {
    await reject(result?.error ?? '方案的格式不对')
    return
  }
  const proposal = result.proposal
  // 方案只能在“对齐这一步正等人交方案”时落地：状态和身份由命令目录判定。
  const refusal = commandRefusal({ command: 'submit_plan', room, by: COMMAND_BY.LEAD, stageIndex: 0 })
  if (refusal !== null) {
    await reject(refusal.text)
    return
  }
  // 包漏掉目标里点名的文件时当场退回：等执行官写完再被边界退回，会白烧一轮复核。
  const named = goalPathsOf(room.goal)
  const planned = new Set(proposal.plan.stages.flatMap(stage => (
    Array.isArray(stage.packages) ? stage.packages : []
  ).flatMap(pkg => (Array.isArray(pkg.files) ? pkg.files : []).map(goalFileOf))))
  // 包里的文件可以是目录（`tools/`），按前缀算覆盖，不能只认一字不差的路径。
  const missingFiles = named.filter(path => !writesPath(planned, path))
  if (missingFiles.length > 0) {
    await reject(`目标里点名的文件没有落进任何工作包：${missingFiles.join('、')}；包就是写边界，漏掉的文件写不进去。`)
    return
  }
  const instances = await engine.instances()
  const byId = new Map(instances.map(item => [item.id, item]))
  // 退回时说清这台机器上能用什么：只说“找不到”会让同一个错再犯一次。
  const offered = () => instances
    .filter(item => item?.available !== false && typeof item?.models?.default === 'string' && item.models.default !== '')
    .map(item => `${item.id}（默认模型 ${item.models.default}）`)
    .join('；')
  // 模型名是这台机器的配置，不是规划的决定：写错或没写就用引擎的默认模型，直接改对，
  // 不为此退一轮。只有引擎找不到才退回——那会改变队伍本身。
  const modelNotes = new Map()
  const normalizeModel = member => {
    const instance = byId.get(member.engine)
    const optionIds = (Array.isArray(instance.models?.options) ? instance.models.options : [])
      .map(option => (typeof option === 'string' ? option : option?.id))
      .filter(id => typeof id === 'string' && id !== '')
    const defaultModel = typeof instance.models?.default === 'string' ? instance.models.default : ''
    const given = typeof member.model === 'string' ? member.model.trim() : ''
    if (given !== '' && (given === defaultModel || optionIds.includes(given))) return given
    const chosen = defaultModel !== '' ? defaultModel : (optionIds[0] ?? '')
    if (chosen !== '' && given !== chosen) {
      member.model = chosen
      modelNotes.set(member.name ?? member.engine, `${member.name ?? member.engine} 用 ${member.engine}/${chosen}`)
    }
    return chosen
  }
  // 这台机器只有一台能干活的引擎时，引擎名写错也直接改对：没有第二条路可选，
  // 退一轮只是多烧一次模型。有多台时引擎是规划真正的选择，写错要退。
  // “能干活的引擎”按同一份可用性规则算：装了但没有工具面或不会先问人的（claude/codex v1）不算。
  const ready = instances.filter(item => item?.available !== false && engineReady(item, { requireApproval: true }))
  const workable = member => {
    const instance = byId.get(member.engine)
    return instance !== undefined && ready.includes(instance)
  }
  for (const member of [...proposal.crew.executors, ...proposal.crew.verifiers]) {
    // 名字写错、或者写的是装了但这一版还不能动手的引擎（claude/codex v1），都按同一件事处理：
    // 这台机器只有一条路时直接改对并说明；有多条路时引擎是规划真正的选择，要退回。
    if (!workable(member)) {
      if (ready.length === 1) {
        member.engine = ready[0].id
        modelNotes.set(member.name ?? member.engine, `${member.name ?? member.engine} 用 ${ready[0].id}`)
      } else {
        await reject(`${byId.get(member.engine) === undefined ? `找不到引擎 ${member.engine}` : `${byId.get(member.engine).name ?? member.engine} 这一版还不能在工作室干活`}；这台机器上能用的是 ${offered()}。engine 只填引擎名，模型由引擎的默认值决定`)
        return
      }
    }
    normalizeModel(member)
  }
  const pool = verifierPool === undefined ? readVerifierPool() : verifierPool
  const poolWarnings = []
  for (const verifier of proposal.crew.verifiers) {
    const issue = verifierPoolIssue({ pool, engine: verifier.engine, model: verifier.model })
    if (issue.error !== undefined) { await reject(issue.error); return }
    if (issue.warning !== undefined) poolWarnings.push(issue.warning)
  }
  const vendorOf = member => byId.get(member.engine)?.engine ?? member.engine
  // 厂商多样性只数真能干活的引擎；装了但不能动手的（codex/claude v1）不凑成“另一家”。
  const vendors = new Set(ready.map(item => item.engine ?? item.id))
  const executorVendors = new Set(proposal.crew.executors.map(vendorOf))
  const crossVendor = proposal.crew.verifiers.every(verifier => !executorVendors.has(vendorOf(verifier)))
  if (!crossVendor && vendors.size >= 2) {
    await reject('每一位验收员都要和所有执行官用不同厂商的模型；换一位验收员。')
    return
  }
  if (!crossVendor) {
    // 只装了一家模型：不挡开工，但要如实说清这一轮是模型自查，不算独立复核。
    store.appendMessage(roomId, { kind: 'system', text: '这台电脑只装了一家模型；这一轮的验收是模型自查，不算独立复核。' })
  }
  const needed = executorsNeeded(proposal.plan.stages)
  if (proposal.crew.executors.length !== needed) {
    await reject(needed === 1
      ? '这一版只有一块独立工作包，只留一位执行官。'
      : `方案里有 ${needed} 块互不重叠的工作包，需要 ${needed} 位执行官。`)
    return
  }
  if (needed > 1 && workspaceOf(room).capabilities().merge !== true) {
    await reject('这个工作文件夹不能合并改动；把工作包并成一位执行官能做的一步。')
    return
  }
  const highRisk = proposal.plan.stages.some(stage => (
    (Array.isArray(stage.packages) ? stage.packages.length : 0) >= 2 ||
    (Array.isArray(stage.packages) ? stage.packages : []).some(item => (
      (Array.isArray(item.files) ? item.files : []).some(isProtectedPath)
    ))
  ))
  if (highRisk && vendors.size >= 2) {
    if (proposal.crew.verifiers.length < 2) {
      await reject('这一步会并行改动或改到受保护文件；高风险默认开两位验收员。')
      return
    }
    const verifierVendors = new Set(proposal.crew.verifiers.map(vendorOf))
    if (verifierVendors.size < 2) {
      await reject('高风险这一步的两位验收员要来自不同厂商；换一位验收员。')
      return
    }
  }
  if (highRisk && vendors.size < 2) {
    store.appendMessage(roomId, { kind: 'system', text: '这一步属于高风险，但这台电脑只有一家模型；只能做模型自查，不算独立复核。' })
  }

  const added = []
  const rollback = async () => {
    for (const memberId of added.reverse()) {
      try {
        const current = store.readRoom(roomId)
        if (current !== null) await memberRemove.remove(current, { memberId })
      } catch {}
    }
  }
  const crew = []
  for (const executor of proposal.crew.executors) {
    const addedResult = await memberAdd.add(store.readRoom(roomId), {
      role: 'worker',
      name: executor.name ?? '',
      engine: executor.engine,
      model: executor.model,
    })
    if (addedResult?.ok !== true) {
      await rollback()
      await reject(addedResult?.error ?? '执行官没能开出来')
      return
    }
    added.push(addedResult.body.memberId)
    crew.push({ role: '执行官', ...executor, memberId: addedResult.body.memberId })
  }
  for (const verifier of proposal.crew.verifiers) {
    const verifierResult = await memberAdd.add(store.readRoom(roomId), {
      role: 'verifier',
      name: verifier.name ?? '',
      engine: verifier.engine,
      model: verifier.model,
    })
    if (verifierResult?.ok !== true) {
      await rollback()
      await reject(verifierResult?.error ?? '验收员没能开出来')
      return
    }
    added.push(verifierResult.body.memberId)
    crew.push({ role: '验收员', ...verifier, memberId: verifierResult.body.memberId })
  }

  const current = store.readRoom(roomId)
  // 启动态只有规划师，房间的交付路径还指着规划师的只读副本；组队后改到第一位执行官的 worktree。
  const firstWorker = crew.find(item => item.role === '执行官')
  const workerPath = firstWorker === undefined ? '' : (current.worktrees?.[firstWorker.memberId] ?? '')
  if (typeof workerPath === 'string' && workerPath !== '') {
    store.updateRoom?.(roomId, roomNow => {
      roomNow.repoPath = workerPath
      const branch = roomNow.branches?.[firstWorker.memberId]
      if (typeof branch === 'string' && branch !== '') {
        roomNow.primaryBranch = branch
        // 复核副本按 room.branch 同步；启动态没有这个字段，组队后补上。
        roomNow.branch = branch
      }
      return { events: [] }
    })
  }
  // 规划师是在自己的只读副本里写方案的，可能把那个绝对路径带进交付物或文件清单；
  // 执行官在自己的 worktree 里工作，平台把旧路径换成仓库根目录的相对写法。
  const stalePath = typeof current.repoPath === 'string' ? current.repoPath.replace(/\/+$/, '') : ''
  const cleanPath = value => {
    if (typeof value !== 'string' || stalePath === '') return value
    return value.split(`${stalePath}/`).join('').split(stalePath).join('.')
  }
  const planForStages = {
    ...proposal.plan,
    contract: proposal.contract,
    stages: proposal.plan.stages.map(stage => ({
      title: stage.title,
      deliverable: cleanPath(stage.deliverable ?? ''),
      behavior: stage.behavior === 'preserve' ? 'preserve' : 'change',
      ...(Array.isArray(stage.clauseIds) ? { clauseIds: stage.clauseIds } : {}),
      ...(Array.isArray(stage.packages)
        ? {
          packages: stage.packages.map(item => ({
            title: item.title,
            files: (item.files ?? []).map(cleanPath),
            clauseIds: [...new Set((Array.isArray(item.clauseIds) ? item.clauseIds : []).map(String).filter(Boolean))],
          })),
        }
        : {}),
    })),
  }
  const built = buildStages({
    title: String(current.goal ?? '').trim() || current.name,
    plan: planForStages,
    align: true,
  })
  // 对齐这一步由方案本身收口；第一步工作阶段直接开跑。
  const stages = built.stages.map((stage, index) => (
    index === 0 ? { ...stage, state: STAGE_STATE.passed, passedAt: Date.now() } : stage
  ))
  const workIndex = stages.findIndex((stage, index) => index > 0 && stage.spine !== true)
  store.updateRound(roomId, round => {
    round.plan = planForStages
    round.stages = stages
    if (workIndex >= 0) round.stages[workIndex].state = STAGE_STATE.active
    return { events: [{ type: 'plan.applied', payload: { members: crew.map(item => item.memberId), stages: stages.length } }] }
  })
  // 有独立工作包时，这一轮按并行派发；单个包仍按流水线。orchestration 属于轮次。
  store.updateRound(roomId, current => {
    current.orchestration = needed > 1 ? 'parallel' : current.orchestration
    return { events: [] }
  })
  const crewText = crew.map(item => `${item.role} ${memberDisplayName(store.readRoom(roomId), item.memberId)}（${item.model}）`).join('、')
  store.appendMessage(roomId, { kind: 'system', text: `队伍已经开好：${crewText}。` })
  if (modelNotes.size > 0) {
    // 引擎和模型不是规划的决定：补成这台机器的实际值时说出来，别让房间以为原样生效了。
    store.appendMessage(roomId, { kind: 'system', text: `引擎和模型按这台机器补上了：${[...modelNotes.values()].join('、')}。` })
  }
  for (const warning of poolWarnings) {
    store.appendMessage(roomId, { kind: 'system', text: warning })
  }
  emit?.('room', store.readRoom(roomId))
  if (workIndex >= 0) {
    try {
      await live.startStage(store.readRoom(roomId), workIndex)
    } catch (error) {
      systemNotice({ store, roomId, text: '队伍开好了，但第一步没能开始；待处理。', error })
    }
  }
  }
  // 同一间房只跑一次组队；两个 submit_plan 同时到达时，第二个直接忽略。
  return async (roomId, result) => {
    if (applying.has(roomId)) return
    applying.add(roomId)
    try {
      return await apply(roomId, result)
    } finally {
      applying.delete(roomId)
    }
  }
}
