// 执行官只写自己的工作包：平台按派发时的包和人一一对应，算出一回合允许改的文件。
// 包为空时不限制（老房间没有工作包）；单个执行官拿走这一步全部包。
import { isAbsolute, relative } from 'node:path'
import { PROOF_FILE } from '../../../../shared/proof.js'
import { workerIds } from '../../room-members.js'

const normalize = (file, root = '') => {
  let value = String(file ?? '').trim().replace(/\\/g, '/')
  if (value === '') return ''
  if (root !== '' && isAbsolute(value)) value = relative(root, value).replace(/\\/g, '/')
  return value.replace(/^\.\//, '')
}

const filesOf = pkg => (Array.isArray(pkg?.files) ? pkg.files : []).map(file => normalize(file)).filter(Boolean)

// 派发时谁拿到哪一块：每个包一个人，按包顺序对应；只有一位执行官时他拿走全部包。
const assigneesOf = ({ room, stage, packages }) => {
  const workers = workerIds(room)
  const proposed = Array.isArray(stage?.assignees)
    ? stage.assignees.filter(member => workers.includes(member))
    : []
  const pool = proposed.length > 0 ? proposed : workers
  if (room?.orchestration !== 'parallel' || packages.length === 1) return pool.slice(0, 1)
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
  return normalized.length === 0 ? null : [...new Set([...normalized, PROOF_FILE])]
}

// 包里的路径可以是文件，也可以是目录（按前缀放行）。
export const filesOutsidePackage = ({ files, allowed }) => {
  if (!Array.isArray(allowed) || allowed.length === 0) return []
  return (Array.isArray(files) ? files : [])
    .map(file => normalize(file))
    .filter(file => file !== '' && !allowed.some(item => (
      file === item || file.startsWith(`${item.replace(/\/+$/, '')}/`)
    )))
}
