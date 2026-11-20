import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { auditPng } from '../../visual-audit.js'

const HTML = /\.html?$/i

export const htmlFilesOf = files => (Array.isArray(files) ? files : [])
  .filter(file => typeof file === 'string' && HTML.test(file))

// 给验收员一张真的渲染图：把本阶段的 HTML 交付截下来，上传成基座附件。
// 同一个证据只截一次；没有 Chrome 或上传失败就安静跳过。
export const ensurePreviews = async ({ room, stageIndex, evidence, capture, attachments, updateRoom }) => {
  const stage = Number(stageIndex)
  const existing = (room.previews ?? []).filter(item => item.stage === stage && item.evidenceId === evidence.id)
  if (existing.length > 0) return existing
  const files = Array.isArray(evidence.meta?.changedFiles)
    ? evidence.meta.changedFiles
    : Array.isArray(evidence.meta?.files) ? evidence.meta.files : []
  const targets = htmlFilesOf(files).slice(0, 2)
  if (
    targets.length === 0 ||
    typeof capture !== 'function' ||
    typeof attachments?.uploadImage !== 'function' ||
    typeof room.repoPath !== 'string' ||
    room.repoPath === ''
  ) return []

  const dir = join(room.repoPath, '.lodge', 'previews')
  const previews = []
  for (const relative of targets) {
    const source = join(room.repoPath, relative)
    if (!existsSync(source)) continue
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      return []
    }
    const label = basename(relative).replace(/[^\w.-]+/g, '-')
    const local = join(dir, `stage-${stage + 1}-${label}.png`)
    const shot = await capture({ file: source, out: local })
    if (shot === null || !existsSync(shot)) continue
    try {
      const bytes = readFileSync(shot)
      const audit = await auditPng({ file: shot })
      const saved = await attachments.uploadImage(bytes, 'image/png')
      const name = basename(saved?.path ?? '')
      if (name === '') continue
      previews.push({
        stage,
        evidenceId: evidence.id,
        label: relative,
        local,
        path: saved.path,
        name,
        mime: 'image/png',
        bytes: bytes.length,
        ...(audit === null ? {} : { audit }),
      })
    } catch {
      // 上传失败只影响视觉证据，不影响验收本身。
    }
  }
  if (previews.length === 0) return []
  const saved = updateRoom(room.id, current => {
    current.previews = [...(current.previews ?? []).filter(item => item.stage !== stage), ...previews]
    return { events: [] }
  })
  return (saved?.previews ?? previews).filter(item => item.stage === stage)
}
