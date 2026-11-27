// 房间的三项权限：文件怎么改、网络用多少、外部动作问不问。
// 这是产品层唯一的策略来源；成员设置、审批桥和界面都从这里读，不各写一套。

export const ROOM_POLICY_DEFAULTS = Object.freeze({
  files: 'direct',
  network: 'proxy',
  external: 'ask',
})

const KEYS = Object.freeze({
  files: new Set(['direct', 'confirm']),
  network: new Set(['proxy', 'model']),
  external: new Set(['ask', 'auto']),
})

// 界面用同一份词；短标签放状态行，长标签放设置项。
export const ROOM_POLICY_OPTIONS = Object.freeze({
  files: Object.freeze([
    Object.freeze({ value: 'direct', label: '直接改工作副本', short: '改文件直接做' }),
    Object.freeze({ value: 'confirm', label: '每一步都问我（改文件、跑命令）', short: '每步先问' }),
  ]),
  network: Object.freeze([
    Object.freeze({ value: 'proxy', label: '模型 + 允许的网站', short: '模型 + 允许的网站' }),
    Object.freeze({ value: 'model', label: '只连模型', short: '只连模型' }),
  ]),
  external: Object.freeze([
    Object.freeze({ value: 'ask', label: '高风险动作先问我', short: '外部动作先问' }),
    Object.freeze({ value: 'auto', label: '直接做，不问我', short: '外部动作直接做' }),
  ]),
})

const optionOf = (key, value) => (ROOM_POLICY_OPTIONS[key] ?? []).find(item => item.value === value)

export const roomPolicyOf = room => {
  const raw = room?.policy
  // 没有 policy 或缺键都按保守默认读；旧行为没有第二份定义。
  if (raw === null || typeof raw !== 'object') return ROOM_POLICY_DEFAULTS
  const policy = {}
  for (const key of Object.keys(KEYS)) {
    policy[key] = KEYS[key].has(raw[key]) ? raw[key] : ROOM_POLICY_DEFAULTS[key]
  }
  return policy
}

// 建房与设置共用：只接受声明过的值；没传的键沿用当前值。
export const normalizeRoomPolicy = (input, base = ROOM_POLICY_DEFAULTS) => {
  const current = { ...ROOM_POLICY_DEFAULTS, ...(base ?? {}) }
  if (input === undefined || input === null) return { policy: current }
  if (typeof input !== 'object' || Array.isArray(input)) return { error: '权限设置不对' }
  const policy = { ...current }
  for (const key of Object.keys(KEYS)) {
    const value = input[key]
    if (value === undefined) continue
    if (!KEYS[key].has(value)) return { error: '权限设置不对' }
    policy[key] = value
  }
  return { policy }
}

// 需要审批卡才能改文件，或外部动作要问人：基座都得先停下来问。
export const approvalOf = policy => (
  policy?.files === 'confirm' || policy?.external === 'ask' ? 'ask' : 'auto'
)

// 只连模型用基座的“只放行模型厂商”代理；其余走默认白名单。
export const networkModeOf = policy => (policy?.network === 'model' ? 'model' : 'proxy')

export const policySummaryOf = (policy, { files = true, external = true } = {}) => Object.keys(KEYS)
  .filter(key => (files || key !== 'files') && (external || key !== 'external'))
  .map(key => optionOf(key, policy?.[key])?.short ?? '')
  .filter(Boolean)
  .join(' · ')

export const policyIsDefault = policy => Object.keys(KEYS)
  .every(key => policy?.[key] === ROOM_POLICY_DEFAULTS[key])
