// 通过之前要有亲手验过的痕迹：跑过一条命令，或读过这次改动里的文件。
// 只认 read/exec 两类真实工具调用；判定工具自己不算证据。
import { actionForTool } from '../../../../../shared/tool-action.js'

const normalize = value => String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '')

// 基座把工具入参作为一格 JSON 字符串交上来（pi 的活动消息就是这样）；
// 不解析它，命令和路径都读不到，重跑证明会被误判成没跑。
const inputOf = call => {
  const raw = call?.input
  if (raw !== null && typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

const targetOf = call => {
  const step = call?.step ?? {}
  const input = inputOf(call)
  return [
    step.target,
    step.detail,
    call?.target,
    call?.detail,
    input.file_path,
    input.path,
    input.command,
  ]
    .filter(value => typeof value === 'string' && value.trim() !== '')
    .map(normalize)
    .join(' ')
}

// 命令按段比较：允许在前后加 `cd`、`; echo` 这类观察，但不允许只把命令打印出来。
const segmentsOf = text => String(text ?? '')
  .split(/&&|\|\||[;|\n]/)
  .map(part => part.trim().replace(/\s+/g, ' '))
  .filter(part => part !== '')

// 只把命令打印出来不算跑过：整条执行就是一句 echo/printf/cat。
const PRINT_ONLY = /^(?:echo|printf|cat|less|head|tail|grep|sed)\b/

// 命令按“这次真的执行了这条命令”来认：整条命令按空白归一后包含它就算。
// 外面包一层 cd、子 shell、括号、`echo == entry ==` 观察都是同一次执行——
// 逐段严格相等会因为一个括号或一个等价写法把真的重跑判成没跑（真房发生过）。
const sameCommand = (target, entry) => {
  const wanted = String(entry ?? '').replace(/\s+/g, ' ').trim()
  const given = String(target ?? '').replace(/\s+/g, ' ').trim()
  if (wanted === '' || given === '') return false
  if (!given.includes(wanted)) return false
  return !(segmentsOf(given).length === 1 && PRINT_ONLY.test(given))
}

export const verificationProofOf = (calls, { changedFiles = [], requiredEntries = [] } = {}) => {
  const files = (Array.isArray(changedFiles) ? changedFiles : [])
    .map(normalize)
    .filter(file => file !== '')
  const entries = (Array.isArray(requiredEntries) ? requiredEntries : [])
    .map(entry => String(entry ?? '').trim())
    .filter(entry => entry !== '')
  const list = Array.isArray(calls) ? calls : []
  if (entries.length > 0) {
    const execs = list.filter(call => actionForTool(call?.name) === 'exec')
    // 交付有 N 份 package 证明时，每一份都要在复核副本里重跑过；少一份就不算亲手验过。
    const missing = entries.filter(entry => !execs.some(call => sameCommand(targetOf(call), entry)))
    return missing.length === 0
      ? { ok: true, kind: 'proof', tool: '' }
      : { ok: false, files, requiredEntries: entries, missing }
  }
  for (const call of list) {
    const action = actionForTool(call?.name)
    if (action === 'exec') return { ok: true, kind: 'exec', tool: String(call?.name ?? '') }
    if (action !== 'read' || files.length === 0) continue
    const target = targetOf(call)
    if (target === '') continue
    const hit = files.some(file => (
      target === file ||
      target.includes(file) ||
      (target.length >= 3 && file.endsWith(`/${target}`))
    ))
    if (hit) return { ok: true, kind: 'read', tool: String(call?.name ?? '') }
  }
  return { ok: false, files, requiredEntries: [] }
}
