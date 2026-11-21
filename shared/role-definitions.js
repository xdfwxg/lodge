import { DEFAULT_STUDIO_ROSTER } from './studio-roster.js'
import { skillsForRole } from './role-toolbox.js'

const names = Object.fromEntries(DEFAULT_STUDIO_ROSTER.map(member => [member.role, member.name]))

// 角色是定义，房间成员是实例：prompt、执行器、规则、技能、MCP 和门都挂在这里。
export const ROLE_DEFINITIONS = Object.freeze({
  lead: Object.freeze({
    id: 'planner',
    role: 'lead',
    name: names.lead,
    title: '规划',
    station: '只读 · 拆阶段与派活',
    engine: 'claude-cli',
    permissions: Object.freeze({ read: true, exec: false, write: false }),
    writeScope: 'none',
    toolSurface: Object.freeze(['read']),
    skills: skillsForRole('lead'),
    mcp: Object.freeze([]),
    approval: 'ask',
    rules: Object.freeze(['不写文件', '不跑验收', '只做对齐、派发和收口']),
    artifacts: Object.freeze(['plan', 'brief']),
    gates: Object.freeze(['plan-review', 'dispatch']),
    prompt: '你是规划师。你的执行成员是 @执行官，验收成员是 @验收员。用简洁、直接的中文沟通；先理解目标与证据，再表达判断；不确定就说不确定。先说下一步和谁做；不确定就只问一个最关键的问题。',
  }),
  worker: Object.freeze({
    id: 'executor',
    role: 'worker',
    name: names.worker,
    title: '实现',
    station: '独立副本写 · 改代码跑测试',
    engine: 'codex-cli',
    permissions: Object.freeze({ read: true, exec: true, write: true }),
    writeScope: 'own_worktree',
    toolSurface: Object.freeze(['read', 'exec', 'write']),
    skills: skillsForRole('worker'),
    mcp: Object.freeze([]),
    approval: 'ask',
    rules: Object.freeze(['只改自己的工作副本', '完成后说明结果', '外部动作先问人']),
    artifacts: Object.freeze(['diff', 'evidence']),
    gates: Object.freeze(['acceptance']),
    prompt: '你是执行官。你的验收成员是 @验收员。用简洁、直接的中文沟通；只围绕当前指派工作；完成后说明结果。先说做完没有、证据在哪；不复述任务。',
  }),
  verifier: Object.freeze({
    id: 'verifier',
    role: 'verifier',
    name: names.verifier,
    title: '复核',
    station: '只读副本 · 只写结论',
    engine: 'claude-cli',
    permissions: Object.freeze({ read: true, exec: true, write: false }),
    writeScope: 'none',
    toolSurface: Object.freeze(['read', 'exec']),
    skills: skillsForRole('verifier'),
    mcp: Object.freeze([]),
    approval: 'ask',
    rules: Object.freeze(['只依据证据判断', '不替执行官解释', '只写结论']),
    artifacts: Object.freeze(['verdict']),
    gates: Object.freeze(['verdict']),
    prompt: '你是验收员。用简洁、直接的中文沟通；先给判定，再给证据；只依据证据判断，不替作者解释。',
  }),
})

export const roleDefinitionOf = role => ROLE_DEFINITIONS[role] ?? null

export const materializeRole = (role, overrides = {}) => {
  const definition = roleDefinitionOf(role)
  if (definition === null) return null
  return {
    ...definition,
    ...overrides,
    permissions: { ...definition.permissions, ...(overrides.permissions ?? {}) },
    toolSurface: [...(overrides.toolSurface ?? definition.toolSurface)],
    skills: [...(overrides.skills ?? definition.skills)],
    mcp: (overrides.mcp ?? definition.mcp).map(grant => ({ ...grant, scopes: [...(grant.scopes ?? [])] })),
    rules: [...(overrides.rules ?? definition.rules)],
    artifacts: [...(overrides.artifacts ?? definition.artifacts)],
    gates: [...(overrides.gates ?? definition.gates)],
  }
}
