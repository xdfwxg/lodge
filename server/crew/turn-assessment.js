// 回合诊断的评估段只写可核对的事实：看到了什么、还有什么不知道、下一步查什么。
// 不交给模型自由发挥，避免把猜测写成诊断结论。
const NEXT_BY_OUTCOME = {
  evidence: '核对证据和交接状态，等待验收',
  review: '核对验收判定和证据 id',
  decision: '核对规划师判定和交接是否收起',
  stale: '确认新回合的交接时间与 turnId',
  empty: '检查续接或重开记录；必要时交给人',
  ignored: '确认这个回合是否应由成员处理',
  captured: '查看同一 turnId 是否有后续诊断',
}

const seconds = durationMs => (
  typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
    ? `${(durationMs / 1000).toFixed(1)}s`
    : ''
)

const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value !== ''))]

export const assessTurn = ({ outcome, turn = {}, extra = {} } = {}) => {
  const tools = Array.isArray(turn.tools) ? turn.tools : []
  const failures = tools.filter(tool => Number(tool?.failed ?? 0) > 0)
  const evidence = []
  const unknown = []

  const duration = seconds(turn.durationMs)
  if (duration !== '') evidence.push(`耗时 ${duration}`)
  if (Number(turn.toolCalls ?? 0) > 0) {
    const names = tools
      .map(tool => `${tool?.name ?? '工具'}×${tool?.count ?? 1}`)
      .join('、')
    evidence.push(`工具调用 ${turn.toolCalls} 次${names === '' ? '' : `：${names}`}`)
  }
  if (failures.length > 0) {
    evidence.push(`失败工具：${failures.map(tool => tool?.name ?? '工具').join('、')}`)
  }
  if (Array.isArray(extra.evidenceIds) && extra.evidenceIds.length > 0) {
    evidence.push(`证据：${extra.evidenceIds.join('、')}`)
  }
  if (typeof extra.assignmentId === 'string' && extra.assignmentId !== '') {
    evidence.push(`交接：${extra.assignmentId}`)
  }
  if (turn.usage !== undefined && turn.usage !== null) {
    const input = Number.isFinite(turn.usage.input) ? turn.usage.input : 0
    const output = Number.isFinite(turn.usage.output) ? turn.usage.output : 0
    evidence.push(`用量：输入 ${input} / 输出 ${output}`)
  }

  if (Number(turn.toolCalls ?? 0) === 0) unknown.push('没有观察到工具调用')
  if (String(turn.reply ?? '').trim() === '') unknown.push('回复为空')
  if (turn.usage === undefined || turn.usage === null) unknown.push('没有用量记录')
  else if (typeof turn.usage.costUsd !== 'number' || !Number.isFinite(turn.usage.costUsd)) unknown.push('费用未知')
  if (turn.hookCoverage === 'none') unknown.push('没有 hook 覆盖，工具调用可能不完整')
  if (outcome === 'captured') unknown.push('终止去向还未归类')
  if (outcome === 'evidence' && (!Array.isArray(extra.evidenceIds) || extra.evidenceIds.length === 0)) {
    unknown.push('已记为证据，但没有证据 id')
  }

  return {
    evidence: unique(evidence),
    unknown: unique(unknown),
    next: [NEXT_BY_OUTCOME[outcome] ?? '查看同一回合的后续诊断'],
  }
}
