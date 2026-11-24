// 规划师提交的“方案 + 队伍”只在这里归一化形状；模型是否存在、厂商是否独立、
// 工作区能不能并行，都由服务端再校验，不把 structuredContent 当授权。
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const list = (value, max, each) => (Array.isArray(value) ? value.map(each).filter(item => item !== null).slice(0, max) : [])

const stageOf = (raw, index) => {
  const title = text(raw?.title, 80)
  if (title === '') return null
  const acceptance = text(raw?.acceptance, 500)
  const manual = raw?.manual === true
  const packages = list(raw?.packages, 3, item => {
    const packageTitle = text(item?.title, 80)
    if (packageTitle === '') return null
    const files = list(item?.files, 12, file => text(file, 200)).filter(file => file !== '')
    return {
      title: packageTitle,
      files,
      ...(text(item?.check, 500) === '' ? {} : { check: text(item?.check, 500) }),
    }
  })
  return {
    title,
    ...(manual ? { manual: true } : {}),
    ...(acceptance === '' ? {} : { acceptance }),
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
  const done = list(input.plan?.done, 6, item => {
    const value = text(item, 200)
    return value === '' ? null : value
  })
  if (done.length === 0) return { error: '方案里没有可核对的结果' }
  const stages = list(input.plan?.stages, 3, (item, index) => stageOf(item, index))
  if (stages.length === 0) return { error: '方案里没有阶段' }
  const executors = list(input.crew?.executors, 3, memberOf)
  if (executors.length === 0) return { error: '队伍里没有执行官' }
  const verifiers = list(input.crew?.verifiers, 3, memberOf)
  if (verifiers.length === 0) return { error: '队伍里没有验收员，或验收员缺 engine/model' }
  const names = [...verifiers, ...executors].map(member => (member.name ?? '').toLowerCase()).filter(Boolean)
  if (new Set(names).size !== names.length) return { error: '成员名字不能重复' }
  return {
    proposal: {
      why: text(input.why, 1000),
      assumptions: list(input.assumptions, 6, item => text(item, 300)).filter(Boolean),
      notDoing: list(input.notDoing, 6, item => text(item, 300)).filter(Boolean),
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
