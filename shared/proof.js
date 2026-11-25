// 交付自带的证明清单：工作区根目录的 lodge-proof.json。
// 只写“怎么证明”，不写验收结论；执行结果由平台记录。
export const PROOF_FILE = 'lodge-proof.json'
const PROOF_VERSION = 1
// 命令可以是一条长管道或 node -e；截断命令等于把它改成另一条坏命令，
// 所以超长时宁可当“没有证明”，也不执行半条。
export const PROOF_ENTRY_LIMIT = 2_000

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const command = value => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' || trimmed.length > PROOF_ENTRY_LIMIT ? '' : trimmed
}

const stepOf = item => {
  if (item === null || typeof item !== 'object') return null
  const clause = text(item.clause, 40)
  const run = command(item.run)
  const expect = text(item.expect, 300)
  if (run === '') return null
  return { ...(clause === '' ? {} : { clause }), run, ...(expect === '' ? {} : { expect }) }
}

export const normalizeProof = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const entry = command(value.entry)
  if (entry === '') return null
  return {
    version: PROOF_VERSION,
    entry,
    steps: (Array.isArray(value.steps) ? value.steps : []).map(stepOf).filter(Boolean).slice(0, 6),
  }
}
