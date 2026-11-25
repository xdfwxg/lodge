// 通过之前要有亲手验过的痕迹：跑过一条命令，或读过这次改动里的文件。
// 只认 read/exec 两类真实工具调用；判定工具自己不算证据。
import { actionForTool } from '../../../../shared/tool-action.js'

const normalize = value => String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '')

const targetOf = call => {
  const step = call?.step ?? {}
  return [
    step.target,
    step.detail,
    call?.target,
    call?.detail,
    call?.input?.file_path,
    call?.input?.path,
    call?.input?.command,
  ]
    .filter(value => typeof value === 'string' && value.trim() !== '')
    .map(normalize)
    .join(' ')
}

const sameCommand = (target, entry) => {
  const left = normalize(target)
  const right = normalize(entry)
  return left !== '' && right !== '' && (left.includes(right) || right.includes(left))
}

export const verificationProofOf = (calls, { changedFiles = [], requiredEntry = '' } = {}) => {
  const files = (Array.isArray(changedFiles) ? changedFiles : [])
    .map(normalize)
    .filter(file => file !== '')
  for (const call of Array.isArray(calls) ? calls : []) {
    const action = actionForTool(call?.name)
    if (action === 'exec') {
      // 有交付自带的证明时，PASS 之前必须重跑同一条 entry，不能换一套自己的检查。
      if (requiredEntry !== '' && !sameCommand(targetOf(call), requiredEntry)) continue
      return { ok: true, kind: requiredEntry === '' ? 'exec' : 'proof', tool: String(call?.name ?? '') }
    }
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
  return { ok: false, files, requiredEntry }
}
