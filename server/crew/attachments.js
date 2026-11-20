import {
  ATTACHMENT_FILE_MAX_BYTES,
  ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_TEXT_MAX_CHARS,
  ATTACHMENT_TOTAL_MAX_BYTES,
  attachmentNameOf,
  isNativeImage,
} from '../../shared/attachments.js'

// 基座只认自己生成的 uuid 文件名；别人塞进来的路径和名字在这里一律拒绝。
const NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/i

export const isAttachmentName = value => typeof value === 'string' && NAME.test(value)

export const normalizeAttachments = value => {
  if (value === undefined || value === null) return { attachments: [] }
  if (!Array.isArray(value)) return { error: '附件格式不对' }
  if (value.length === 0) return { attachments: [] }
  if (value.length > ATTACHMENT_MAX_COUNT) return { error: `一条消息最多带 ${ATTACHMENT_MAX_COUNT} 个附件` }
  const attachments = []
  for (const item of value) {
    if (!isAttachmentName(item?.name)) return { error: '附件名不合法' }
    const kind = item?.kind === 'image' ? 'image' : 'file'
    const path = typeof item?.path === 'string' && item.path !== '' ? item.path : item.name
    if (attachmentNameOf(path) !== item.name) return { error: '附件路径不合法' }
    const bytes = Number(item?.bytes)
    const max = kind === 'image' ? ATTACHMENT_IMAGE_MAX_BYTES : ATTACHMENT_FILE_MAX_BYTES
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > max) return { error: '附件大小不合法' }
    const mime = typeof item?.mime === 'string' ? item.mime.slice(0, 100) : ''
    if (kind === 'image' && !isNativeImage(mime)) return { error: '图片格式不支持' }
    const text = typeof item?.text === 'string' ? item.text.slice(0, ATTACHMENT_TEXT_MAX_CHARS) : ''
    const title = typeof item?.title === 'string' ? item.title.slice(0, 120) : ''
    attachments.push({
      name: item.name,
      path,
      mime,
      bytes,
      kind,
      ...(title === '' ? {} : { title }),
      ...(text === '' ? {} : { text }),
    })
  }
  const total = attachments.reduce((sum, item) => sum + item.bytes, 0)
  if (total > ATTACHMENT_TOTAL_MAX_BYTES) return { error: '附件总量最多 40MB' }
  return { attachments }
}

// 文本类文件把正文带进提示词；二进制文件不猜内容。
export const textOfFile = bytes => {
  if (!Buffer.isBuffer(bytes) || bytes.includes(0)) return ''
  const text = bytes.toString('utf8').replace(/^﻿/, '')
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text.slice(0, 2000))) return ''
  return text.slice(0, ATTACHMENT_TEXT_MAX_CHARS).trim()
}
