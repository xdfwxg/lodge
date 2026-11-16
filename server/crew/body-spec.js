// 身体规格的唯一校验：换身体和添加成员都用这一份，避免两套规则各说各话。
const isId = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)
const PROMPT_LIMIT = 4000
const LIST_LIMIT = 8

const grantsOf = list => (Array.isArray(list) ? list : []).slice(0, LIST_LIMIT).map(item => (
  typeof item === 'string'
    ? { server: item.trim(), scopes: ['read'], approval: 'ask' }
    : { server: item.server, scopes: ['read'], approval: 'ask' }
))

export const normalizeBodySpec = ({ input = {}, fallback = {} } = {}) => {
  const prompt = typeof input.prompt === 'string'
    ? input.prompt.trim().slice(0, PROMPT_LIMIT)
    : (typeof fallback.prompt === 'string' ? fallback.prompt : '')
  const skillInput = input.skills === undefined ? fallback.skills : input.skills
  const skills = (Array.isArray(skillInput) ? skillInput : [])
    .map(item => String(item).trim())
    .filter(Boolean)
    .slice(0, LIST_LIMIT)
  if (skills.some(item => !isId(item))) {
    return { error: '技能名只能用字母、数字、下划线或短横线' }
  }
  const mcpInput = input.mcp === undefined ? fallback.mcp : input.mcp
  if ((Array.isArray(mcpInput) ? mcpInput : []).some(item => !isId(typeof item === 'string' ? item : item?.server))) {
    return { error: 'MCP 服务只填服务名，不能放地址或凭证' }
  }
  return { spec: { prompt, skills, mcp: grantsOf(mcpInput) } }
}
