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
