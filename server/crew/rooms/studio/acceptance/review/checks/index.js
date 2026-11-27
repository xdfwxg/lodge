// 一次复核要过的规则，一条一个文件，按顺序跑。
// 每条返回 null（通过）或：
//   { replace: judgment }                         改写判定后继续
//   { flag, nudge, expire }                       需要催一次；催过的同一拍再犯就作废
// 加一条验收规则＝加一个文件 + 在这里排进顺序，不动主流程。
import { protectedFilesCheck } from './protected-files.js'
import { coverageCheck } from './coverage.js'
import { proofFactsCheck } from './proof-facts.js'
import { proofRerunCheck } from './proof-rerun.js'
import { foreignReadsCheck } from './foreign-reads.js'
import { falsifyCheck } from './falsify.js'

export const REVIEW_CHECKS = Object.freeze([
  protectedFilesCheck,
  coverageCheck,
  proofFactsCheck,
  proofRerunCheck,
  foreignReadsCheck,
  falsifyCheck,
])
