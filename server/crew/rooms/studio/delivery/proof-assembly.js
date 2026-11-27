// 并行阶段的证明归属：一个包一份，平台不合并。
//
// 两个执行官各写根目录的 lodge-proof.json，合并时必然在同一个路径上撞车（同一文件、不同内容）。
// 所以执行官提交候选之前，平台把它写在根目录的证明挪成这一包的分片（lodge-proof/<n>.json）；
// 平台跑证明时把根证明和所有分片各自跑一遍，不合成、不生成入口脚本。
// 证明之间没有依赖，就没有“证明的入口再调证明”这类自指的余地。
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PROOF_DIR, PROOF_FILE, packageProofFile } from '../../../../../shared/proof.js'

// 把执行官落在根目录的证明挪成它这一包的分片。已经是分片、或者没有证明，就什么都不做。
export const parkPackageProof = ({ path, index }) => {
  if (typeof path !== 'string' || path === '') return false
  const root = join(path, PROOF_FILE)
  if (!existsSync(root)) return false
  const target = join(path, packageProofFile(index))
  try {
    mkdirSync(join(path, PROOF_DIR), { recursive: true })
    // 分片已经在：内容相同就删掉根目录这份多余的；不同就留成一份附加分片，
    // 也不和别的包撞路径——两个包都写根目录证明正是要避免的事。
    if (existsSync(target)) {
      if (readFileSync(root, 'utf8') === readFileSync(target, 'utf8')) {
        rmSync(root)
      } else {
        renameSync(root, join(path, PROOF_DIR, `${index + 1}.extra.json`))
      }
      return true
    }
    renameSync(root, target)
    return true
  } catch {
    return false
  }
}
