// 规划师提交的“方案 + 队伍”只在这里归一化形状；模型是否存在、厂商是否独立、
// 工作区能不能并行，都由服务端再校验，不把 structuredContent 当授权。
import { clauseIdOf, normalizeContract } from './contract.js'

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const list = (value, max, each) => (Array.isArray(value) ? value.map(each).filter(item => item !== null).slice(0, max) : [])

// 目标、契约要求里点名的文件（带扩展名，或带目录）。带“不要/不改/禁止”的从句不算要求。
const NEGATED = /(不要|不改|禁止|别改|不得)/u
const PATH_TOKEN = /(?:\.\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]|\b[A-Za-z0-9_-]+\.(?:txt|md|json|js|mjs|cjs|ts|tsx|jsx|css|html|yml|yaml|toml|sh|py|rs|go|java|rb)\b/gu
const cleanPath = value => String(value).trim().replace(/^\.\//, '').replace(/[.,。；;]+$/u, '')
export const pathsOf = value => {
  const found = []
  for (const clause of String(value ?? '').split(/[；;。\n]/u)) {
    if (clause.trim() === '' || NEGATED.test(clause)) continue
    for (const match of clause.matchAll(PATH_TOKEN)) {
      const path = cleanPath(match[0])
      if (path !== '') found.push(path)
    }
  }
  return [...new Set(found)]
}
// 这一步写不写这个文件：包里的文件可以是文件，也可以是目录（按前缀放行）。
export const writesPath = (files, path) => [...files].some(file => (
  path === file || path.startsWith(`${file.replace(/\/+$/, '')}/`)
))

const stageOf = (raw, index) => {
  const title = text(raw?.title, 80)
  const deliverable = text(raw?.deliverable, 500)
  if (title === '' || deliverable === '') return null
  const clauseIds = list(raw?.clauseIds, 6, item => clauseIdOf(item)).filter(Boolean)
  if (clauseIds.length === 0) return null
  const packages = list(raw?.packages, 3, item => {
    const packageTitle = text(item?.title, 80)
    if (packageTitle === '') return null
    const files = list(item?.files, 12, file => text(file, 200)).filter(file => file !== '')
    const packageClauses = list(item?.clauseIds, 6, item => clauseIdOf(item)).filter(Boolean)
    return { title: packageTitle, files, clauseIds: [...new Set(packageClauses)] }
  })
  return {
    title,
    deliverable,
    clauseIds: [...new Set(clauseIds)],
    behavior: raw?.behavior === 'preserve' ? 'preserve' : 'change',
    ...(packages.length === 0 ? {} : { packages }),
    index,
  }
}

const memberOf = raw => {
  const engine = text(raw?.engine, 80)
  const model = text(raw?.model, 160)
  if (engine === '' || model === '') return null
  return { engine, model, ...(text(raw?.name, 32) === '' ? {} : { name: text(raw?.name, 32) }) }
}

export const normalizeCrewProposal = input => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { error: '方案格式不对' }
  const contract = normalizeContract(input.contract)
  if (contract === null) return { error: '方案里没有目标契约：写清可观察结果、边界、非目标和假设' }
  if (contract.boundaries.length === 0) return { error: '契约没有边界：写清这一步不能碰什么' }
  if (contract.nonGoals.length === 0) return { error: '契约没有非目标：写清这一步不做什么' }
  const rawStages = Array.isArray(input.plan?.stages) ? input.plan.stages : []
  if (rawStages.length > 3) return { error: '方案最多拆成 3 步' }
  const stages = []
  for (const [index, raw] of rawStages.entries()) {
    const rawPackages = Array.isArray(raw?.packages) ? raw.packages : []
    if (rawPackages.length > 3) return { error: `第 ${index + 1} 步最多 3 个工作包` }
    const stage = stageOf(raw, index)
    // 结构不合格就退回重写，不能悄悄丢掉这一阶段再按剩下的开工。
    if (stage === null) return { error: `第 ${index + 1} 个阶段缺名字、交付物或 clauseId` }
    const contractIds = new Set(contract.outcomes.map(item => item.id))
    const unknownStage = stage.clauseIds.filter(id => !contractIds.has(id))
    if (unknownStage.length > 0) {
      return { error: `第 ${index + 1} 个阶段引用了契约里没有的要求：${unknownStage.join('、')}` }
    }
    if (rawPackages.length === 0) {
      return { error: `第 ${index + 1} 步没有工作包：写清每个包要改的文件和负责的 clauseIds` }
    }
    if (stage.packages.length !== rawPackages.length) {
      return { error: `第 ${index + 1} 步有工作包缺名字` }
    }
    for (const [packageIndex, pkg] of stage.packages.entries()) {
      if (pkg.files.length === 0) {
        return { error: `第 ${index + 1} 步第 ${packageIndex + 1} 个工作包没有文件：每个包都要写清要改的文件，写边界才能生效` }
      }
      if (pkg.clauseIds.length === 0) {
        return { error: `第 ${index + 1} 步第 ${packageIndex + 1} 个工作包没有 clauseIds：每条契约要求都要落到一个包` }
      }
      const unknown = pkg.clauseIds.filter(id => !stage.clauseIds.includes(id))
      if (unknown.length > 0) {
        return { error: `第 ${index + 1} 步的工作包引用了本阶段没有的要求：${unknown.join('、')}` }
      }
    }
    const packageClauses = new Set(stage.packages.flatMap(pkg => pkg.clauseIds))
    const uncovered = stage.clauseIds.filter(id => !packageClauses.has(id))
    if (uncovered.length > 0) {
      return { error: `第 ${index + 1} 步这些契约要求没有落到工作包：${uncovered.join('、')}` }
    }
    // 契约要求里点到的文件，要由写它的那一步来认领：一条要求放在还没写它的步骤里，
    // 执行商会照着“只改这些文件”不写它，验收员按契约判不通过，白跑一轮返工。
    const writesAt = at => new Set((Array.isArray(rawStages[at]?.packages) ? rawStages[at].packages : [])
      .flatMap(item => (Array.isArray(item?.files) ? item.files : []).map(file => cleanPath(text(file, 200))))
      .filter(Boolean))
    for (const clause of contract.outcomes) {
      if (!stage.clauseIds.includes(clause.id)) continue
      for (const path of pathsOf(`${clause.statement}；${clause.observable}`)) {
        if (writesPath(writesAt(index), path)) continue
        const laterIndex = rawStages.findIndex((_other, at) => at > index && writesPath(writesAt(at), path))
        if (laterIndex >= 0) {
          return {
            error: `第 ${index + 1} 步的契约要求「${clause.id}」提到 ${path}，但这一步的工作包不写它，要到第 ${laterIndex + 1} 步才写；把这条要求挪到写出它的那一步，或在这一步的工作包里写上 ${path}`,
          }
        }
      }
    }
    stages.push(stage)
  }
  if (stages.length === 0) return { error: '方案里没有阶段；每个阶段要有交付物和至少一个 clauseId' }
  const clauseIds = new Set(contract.outcomes.map(item => item.id))
  const assigned = new Set(stages.flatMap(stage => stage.clauseIds))
  const unknown = [...assigned].filter(id => !clauseIds.has(id))
  if (unknown.length > 0) return { error: `阶段引用了契约里没有的要求：${unknown.join('、')}` }
  const missing = [...clauseIds].filter(id => !assigned.has(id))
  if (missing.length > 0) return { error: `契约要求没有分配到任何阶段：${missing.join('、')}` }
  // done 是契约的投影，不再接受第二份 done 输入。
  const done = contract.outcomes.map(item => item.statement).slice(0, 6)
  const rawExecutors = Array.isArray(input.crew?.executors) ? input.crew.executors : []
  const rawVerifiers = Array.isArray(input.crew?.verifiers) ? input.crew.verifiers : []
  if (rawExecutors.length > 3) return { error: '执行官最多 3 位' }
  if (rawVerifiers.length > 3) return { error: '验收员最多 3 位' }
  const executors = rawExecutors.map(memberOf)
  if (executors.length === 0) return { error: '队伍里没有执行官' }
  if (executors.some(member => member === null)) return { error: '执行官缺 engine/model' }
  const verifiers = rawVerifiers.map(memberOf)
  if (verifiers.length === 0) return { error: '队伍里没有验收员，或验收员缺 engine/model' }
  if (verifiers.some(member => member === null)) return { error: '验收员缺 engine/model' }
  const names = [...verifiers, ...executors].map(member => (member.name ?? '').toLowerCase()).filter(Boolean)
  if (new Set(names).size !== names.length) return { error: '成员名字不能重复' }
  return {
    proposal: {
      why: text(input.why, 1000),
      assumptions: list(input.assumptions, 6, item => text(item, 300)).filter(Boolean),
      notDoing: list(input.notDoing, 6, item => text(item, 300)).filter(Boolean),
      contract,
      plan: { done, stages: stages.map(({ index, ...stage }) => stage) },
      crew: { executors, verifiers },
    },
  }
}

const overlap = (a, b) => a.some(file => b.includes(file))

// 同一阶段里，文件互不重叠、且都写了文件的包才能并行；其余一律按 1 个执行官。
export const independentPackagesOf = stage => {
  const packages = Array.isArray(stage?.packages) ? stage.packages : []
  if (packages.length < 2) return packages.length
  const withFiles = packages.filter(item => item.files.length > 0)
  if (withFiles.length !== packages.length) return 1
  // 包最多 3 个，直接枚举所有子集求最大独立集；贪心会漏掉“先选大的反而少”的情况。
  let best = 0
  for (let mask = 1; mask < (1 << withFiles.length); mask += 1) {
    const chosen = withFiles.filter((_, index) => (mask & (1 << index)) !== 0)
    const independent = chosen.every((item, index) => (
      chosen.slice(index + 1).every(other => !overlap(other.files, item.files))
    ))
    if (independent) best = Math.max(best, chosen.length)
  }
  return best
}

export const executorsNeeded = stages => Math.max(1, ...(Array.isArray(stages) ? stages : []).map(independentPackagesOf))
