import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseVerifierPool } from '../../shared/verifier-pool.js'

const verifierPoolFileOf = () => (
  typeof process.env.LODGE_VERIFIER_POOL === 'string' && process.env.LODGE_VERIFIER_POOL !== ''
    ? process.env.LODGE_VERIFIER_POOL
    : join(homedir(), '.lodge', 'verifier-pool.json')
)

// 没有池文件时返回 null：还没有实测数据的地方不能假装已经筛过模型。
export const readVerifierPool = (file = verifierPoolFileOf()) => {
  try {
    return parseVerifierPool(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}
