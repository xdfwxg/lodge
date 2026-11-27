// 执行官只写自己的工作包：平台按派发时的包和人一一对应，算出一回合允许改的文件。
// 包为空时不限制（老房间没有工作包）；单个执行官拿走这一步全部包。
import { isAbsolute, relative } from 'node:path'
import { PROOF_DIR, PROOF_FILE } from '../../../../../shared/proof.js'
import { workerIds } from '../../../room-members.js'

const normalize = (file, root = '') => {
  let value = String(file ?? '').trim().replace(/\\/g, '/')
  if (value === '') return ''
  if (root !== '' && isAbsolute(value)) value = relative(root, value).replace(/\\/g, '/')
  return value.replace(/^\.\//, '')
}

const filesOf = pkg => (Array.isArray(pkg?.files) ? pkg.files : []).map(file => normalize(file)).filter(Boolean)
const isProofPath = file => file === PROOF_FILE || file === PROOF_DIR || file.startsWith(`${PROOF_DIR}/`)

// 派发时谁拿到哪一块：每个包一个人，按包顺序对应；只有一位执行官时他拿走全部包。
const assigneesOf = ({ room, stage, packages }) => {
  const workers = workerIds(room)
  const proposed = Array.isArray(stage?.assignees)
    ? stage.assignees.filter(member => workers.includes(member))
    : []
  const pool = proposed.length > 0 ? proposed : workers
  // 编排落在轮次上（房间字段可能没有）：读错地方会让并行阶段的写边界整个失效。
  const orchestration = room?.orchestration ?? room?.workRound?.orchestration
  if (orchestration !== 'parallel' || packages.length === 1) return pool.slice(0, 1)
  return pool.slice(0, packages.length)
}

// 返回这位执行官这一步允许改的相对路径；null 表示不限制。
export const allowedFilesFor = ({ room, stage, memberId, root = '' }) => {
  const packages = Array.isArray(stage?.packages) ? stage.packages.filter(Boolean) : []
  if (packages.length === 0) return null
  const assignees = assigneesOf({ room, stage, packages })
  if (!assignees.includes(memberId)) return null
  const allowed = assignees.length > 1
    ? filesOf(packages[assignees.indexOf(memberId)])
    : packages.flatMap(filesOf)
  const normalized = [...new Set(allowed.map(file => normalize(file, root)).filter(Boolean))]
  // 证明文件不属于任何工作包，但每个包都要能写自己的那份（并行时按包分开）。
  return normalized.length === 0 ? null : [...new Set([...normalized, PROOF_FILE, PROOF_DIR])]
}

// 这个包自己认领了证明文件吗？认领了它就留在根目录（交付里那个名字的真正写者）；
// 没认领的包如果写了根证明，才需要挪成它这一包的分片，避免两个包撞同一路径。
export const ownsProofFileFor = ({ room, stage, memberId }) => {
  const packages = Array.isArray(stage?.packages) ? stage.packages.filter(Boolean) : []
  if (packages.length === 0) return false
  const assignees = assigneesOf({ room, stage, packages })
  if (!assignees.includes(memberId)) return false
  const selected = assignees.length > 1
    ? [packages[assignees.indexOf(memberId)]].filter(Boolean)
    : packages
  return selected.some(pkg => filesOf(pkg).some(isProofPath))
}

// 别的包已经认领的文件：辅助目录放行不能覆盖它们。
// 不这样，一个包只要在证明里引用 tools/，就能顺手写掉另一个包的 tools/check.mjs，
// 两个分支合并时在同一路径上撞车（真房第 33 轮）。
export const reservedFilesFor = ({ room, stage, memberId, root = '' }) => {
  const packages = Array.isArray(stage?.packages) ? stage.packages.filter(Boolean) : []
  if (packages.length === 0) return []
  const assignees = assigneesOf({ room, stage, packages })
  if (!assignees.includes(memberId)) return []
  if (assignees.length <= 1) return []
  const mine = assignees.indexOf(memberId)
  return [...new Set(packages
    .filter((_pkg, index) => index !== mine)
    .flatMap(filesOf)
    .map(file => normalize(file, root))
    .filter(Boolean))]
}

// 包里的路径可以是文件，也可以是目录（按前缀放行）。
// 证明的辅助脚本是例外：只有“这一步新加的文件 + 证明正文点名引用”才算这一步的一部分。
// 修改已有文件、没被证明引用的新文件，仍然按越界处理；别的包认领的文件永远不算辅助文件。
export const filesOutsidePackage = ({ files, allowed, added, proofText, reserved = [] }) => {
  if (!Array.isArray(allowed) || allowed.length === 0) return []
  const addedSet = Array.isArray(added) ? new Set(added.map(file => normalize(file))) : null
  const referenced = file => typeof proofText === 'string' && proofText !== '' && proofText.includes(file)
  // 证明点名的新文件，或包里被证明点名去执行的文件的所在目录，就是这个证明的辅助目录：
  // 证明往往只有一条入口（比如包里的 tools/check.mjs），入口再 import 同目录的辅助脚本；
  // 那些辅助脚本没法一个个点名，但同样是证明的一部分。
  const dirOf = file => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '')
  const named = [
    ...(Array.isArray(added) ? added : []).map(file => normalize(file)),
    ...(Array.isArray(allowed) ? allowed : []).map(file => normalize(file)),
  ].filter(file => file !== '' && referenced(file) && !file.startsWith(PROOF_DIR))
  const supportDirs = new Set(named.map(dirOf).filter(dir => dir !== ''))
  // 别的包认领的路径永远不算“这次证明的一部分”：写它就是在写别人的交付物。
  const claimedByOther = file => reserved.some(item => (
    file === item || file.startsWith(`${item.replace(/\/+$/, '')}/`)
  ))
  return (Array.isArray(files) ? files : [])
    .map(file => normalize(file))
    .filter(file => {
      if (file === '') return false
      if (allowed.some(item => file === item || file.startsWith(`${item.replace(/\/+$/, '')}/`))) return false
      if (claimedByOther(file)) return true
      if (addedSet !== null && addedSet.has(file) && referenced(file)) return false
      // 只放行“新加”的辅助文件；改已有文件仍然越界。
      if (addedSet !== null && addedSet.has(file)) {
        const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
        if (dir !== '' && supportDirs.has(dir)) return false
      }
      return true
    })
}

// git status --porcelain 里哪些是这一步新加的文件（未跟踪或已加入索引的 A）。
// 只有新文件能被证明“带上”；改已有文件仍然越界。
export const addedFilesOf = status => {
  if (typeof status !== 'string' || status.trim() === '') return []
  const added = []
  for (const line of status.split('\n')) {
    if (line.length < 4) continue
    const [index, worktree] = [line[0], line[1]]
    const file = normalize(line.slice(3).trim())
    if (file === '') continue
    if ((index === '?' && worktree === '?') || index === 'A') added.push(file)
  }
  return added
}
