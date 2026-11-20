export const ROLE_TOOLBOX = Object.freeze({
  lead: Object.freeze([
    'lodge-grilling',
    'lodge-task-breakdown',
    'lodge-spec-driven',
    'lodge-codebase-design',
    'lodge-domain-modeling',
    'lodge-api-design',
  ]),
  worker: Object.freeze([
    'lodge-tdd',
    'lodge-diagnose',
    'lodge-incremental',
    'lodge-simplify',
    'lodge-verify-before-done',
    'lodge-frontend-ui',
    'lodge-api-design',
    'lodge-observability',
  ]),
  verifier: Object.freeze([
    'lodge-two-axis-review',
    'lodge-verify-before-done',
    'lodge-security',
    'lodge-browser-evidence',
    'lodge-accessibility',
    'lodge-performance',
    'lodge-observability',
  ]),
})

export const TOOLBOX_SKILLS = Object.freeze([
  ...new Set(Object.values(ROLE_TOOLBOX).flat()),
])

const isSkillName = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)

// 已改名的角色技能从旧成员身上清掉，避免换身体后两个名字并排出现。
const RETIRED_SKILLS = new Set(['lodge-code-review-2'])

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
