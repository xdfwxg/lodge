export const CHAT_STANCES = Object.freeze({
  proposer: '这轮给出 1–2 个具体方案，说清代价和前提。',
  critic: '这轮专门找漏洞、反例和风险；不重复提议，至少指出一条具体依据。',
  synthesizer: '这轮把分歧收成一个可决定的选项；不新开话题。',
})

export const CHAT_STANCE_LABELS = Object.freeze({
  proposer: '提议',
  critic: '质疑',
  synthesizer: '收束',
})

export const stanceOf = value => (
  typeof value === 'string' && Object.hasOwn(CHAT_STANCES, value) ? value : ''
)

export const stancePrompt = value => CHAT_STANCES[stanceOf(value)] ?? ''

export const stanceLabelOf = value => CHAT_STANCE_LABELS[stanceOf(value)] ?? ''
