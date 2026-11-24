export const ROLE_TOOLBOX = Object.freeze({
  lead: Object.freeze([
    'lodge-plan-2',
    'lodge-design',
  ]),
  worker: Object.freeze([
    'lodge-build-2',
    'lodge-diagnose',
    'lodge-ui',
  ]),
  verifier: Object.freeze([
    'lodge-review-2',
    'lodge-ui',
    'lodge-security',
  ]),
})

export const TOOLBOX_SKILLS = Object.freeze([
  ...new Set(Object.values(ROLE_TOOLBOX).flat()),
])

const isSkillName = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)

// 合并进新技能或已停用的旧名字：换身体或旧成员自定义时都清掉，不再挂载。
const RETIRED_SKILLS = new Set([
  'lodge-plan',
  'lodge-build',
  'lodge-review',
  'lodge-code-review-2',
  'lodge-grilling',
  'lodge-task-breakdown',
  'lodge-spec-driven',
  'lodge-codebase-design',
  'lodge-domain-modeling',
  'lodge-api-design',
  'lodge-tdd',
  'lodge-incremental',
  'lodge-simplify',
  'lodge-verify-before-done',
  'lodge-two-axis-review',
  'lodge-browser-evidence',
  'lodge-accessibility',
  'lodge-frontend-ui',
  'lodge-performance',
  'lodge-observability',
])

export const skillsForRole = role => ROLE_TOOLBOX[role] ?? []

export const mergeRoleSkills = (role, requested = []) => {
  if (role === 'participant') return []
  const merged = []
  const seen = new Set()
  for (const name of [...skillsForRole(role), ...(Array.isArray(requested) ? requested : [])]) {
    if (!isSkillName(name) || RETIRED_SKILLS.has(name) || seen.has(name)) continue
    seen.add(name)
    merged.push(name)
  }
  return merged.slice(0, 8)
}
