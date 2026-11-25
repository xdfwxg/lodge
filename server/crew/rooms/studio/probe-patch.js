// 验收探针专用：在验收员副本刷新之后、复核开始之前注入预埋缺陷。
// 只有设置 LODGE_PROBE_REVIEW_PATCH_DIR 时才生效；正常房间没有这个目录，什么也不做。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isWithin } from '../../workspace-paths.js'

const patchOf = (dir, roomId) => {
  try {
    return JSON.parse(readFileSync(join(dir, `${roomId}.json`), 'utf8'))
  } catch {
    return null
  }
}

export const applyProbePatch = ({ dir, roomId, root, stageIndex }) => {
  if (typeof dir !== 'string' || dir === '' || typeof roomId !== 'string' || roomId === '') return []
  if (typeof root !== 'string' || root === '') return []
  const spec = patchOf(dir, roomId)
  if (spec === null || spec.stage !== stageIndex || spec.files === null || typeof spec.files !== 'object') return []
  const base = resolve(root)
  const applied = []
  for (const [relative, content] of Object.entries(spec.files)) {
    if (typeof relative !== 'string' || typeof content !== 'string') continue
    const target = resolve(base, relative)
    if (!isWithin(base, target)) continue
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
    applied.push(relative)
  }
  return applied
}
