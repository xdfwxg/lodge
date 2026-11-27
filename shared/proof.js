// 交付自带的证明：工作区根目录的 lodge-proof.json。
// 只有一件事——一条能重跑的命令（`entry`）。`steps` 是额外的命令，按顺序跑，
// 不带 clause 语义：要求有没有被覆盖由验收员的复核说了算，不由这份文件对账。
export const PROOF_FILE = 'lodge-proof.json'
// 并行阶段一个工作包一份证明：根目录的 lodge-proof.json 只留给单包阶段。
export const PROOF_DIR = 'lodge-proof'
export const packageProofFile = index => `${PROOF_DIR}/${index + 1}.json`
const PROOF_VERSION = 1
// 命令可以是一条长管道或 node -e；截断命令等于把它改成另一条坏命令，
// 所以超长时宁可当“没有证明”，也不执行半条。
export const PROOF_ENTRY_LIMIT = 2_000

const command = value => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' || trimmed.length > PROOF_ENTRY_LIMIT ? '' : trimmed
}

// steps 写成字符串或 `{ run }` 都行；两种都只取命令本身。
const commandsOf = value => (Array.isArray(value) ? value : [])
  .map(item => (typeof item === 'string' ? item : item?.run))
  .map(command)
  .filter(Boolean)
  .slice(0, 8)

export const normalizeProof = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const entry = command(value.entry)
  if (entry === '') return null
  return { version: PROOF_VERSION, entry, steps: commandsOf(value.steps) }
}
