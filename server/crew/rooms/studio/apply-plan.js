import { STAGE_STATE } from '../../../../shared/states.js'
import { executorsNeeded } from '../../../../shared/crew-proposal.js'
import { buildStages } from '../../room-types/studio.js'
import { workspaceOf } from './workspace.js'
import { systemNotice } from '../../notices.js'
import { leadMemberOf } from '../../room-members.js'
import { memberDisplayName } from '../../member-labels.js'

const rejectionLimit = 2

// 规划师提交的方案与队伍：先校验策略，再开通成员，最后把阶段接上并派第一步。
// 任何一步失败都不半建：已经开出来的成员撤掉，对齐继续等下一版。
export const createPlanApplier = ({ store, engine, live, emit, memberAdd, memberRemove, sendToMember = null }) => {
  const applying = new Set()
  const apply = async (roomId, result) => {
  const room = store.readRoom(roomId)
  if (room === null || room.roomType !== 'studio') return
  if (room.workRound?.plan !== null && room.workRound?.plan !== undefined) return
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
  }

  if (result?.proposal === undefined) {
    await reject(result?.error ?? '方案的格式不对')
    return
  }
  const proposal = result.proposal
  const instances = await engine.instances()
  const byId = new Map(instances.map(item => [item.id, item]))
  const problemOf = member => {
    const instance = byId.get(member.engine)
    if (instance === undefined) return `找不到引擎 ${member.engine}`
    const options = Array.isArray(instance.models?.options) ? instance.models.options : []
    if (member.model !== instance.models?.default && !options.includes(member.model)) {
      return `${instance.name ?? member.engine} 没有模型 ${member.model}`
    }
    return ''
  }
  for (const member of [...proposal.crew.executors, ...proposal.crew.verifiers]) {
    const problem = problemOf(member)
    if (problem !== '') { await reject(problem); return }
  }
  const vendorOf = member => byId.get(member.engine)?.engine ?? member.engine
  const vendors = new Set(instances
    .filter(item => item.available !== false && typeof item.models?.default === 'string' && item.models.default !== '')
    .map(item => item.engine ?? item.id))
  const executorVendors = new Set(proposal.crew.executors.map(vendorOf))
  const crossVendor = proposal.crew.verifiers.every(verifier => !executorVendors.has(vendorOf(verifier)))
  if (!crossVendor && vendors.size >= 2) {
    await reject('每一位验收员都要和所有执行官用不同厂商的模型；换一位验收员。')
    return
  }
  if (!crossVendor) {
    // 只装了一家模型：不挡开工，但要如实说清这一轮是模型自查。
    store.appendMessage(roomId, { kind: 'system', text: '这台电脑只装了一家模型；这一轮的验收是模型自查。' })
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
    stages: proposal.plan.stages.map(stage => ({
      title: stage.title,
      deliverable: cleanPath(stage.deliverable ?? ''),
      ...(Array.isArray(stage.packages)
        ? {
          packages: stage.packages.map(item => ({
            title: item.title,
            files: (item.files ?? []).map(cleanPath),
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
