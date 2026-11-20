// 聊天里的图片和文件：图片走原生多模态，文本类文件把正文当上下文带进去，其它文件只留路径。
export const ATTACHMENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const ATTACHMENT_FILE_MAX_BYTES = 25 * 1024 * 1024
export const ATTACHMENT_TEXT_MAX_CHARS = 20_000
// 一条消息最多 10 个附件；总量对齐基座一次最多 40MB 的图片上限。
export const ATTACHMENT_MAX_COUNT = 10
export const ATTACHMENT_TOTAL_MAX_BYTES = 40 * 1024 * 1024

// 基座只把这四种图片当原生图片输入；其它图片按文件处理，至少路径还在。
export const NATIVE_IMAGE_MIMES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export const isNativeImage = mime => NATIVE_IMAGE_MIMES.includes(String(mime ?? '').toLowerCase())

export const isTextFile = mime => {
  const type = String(mime ?? '').toLowerCase()
  return type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/javascript' ||
    type === 'application/x-yaml'
}

export const formatAttachmentBytes = bytes => {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export const attachmentNameOf = path => {
  const value = String(path ?? '')
  return value.split(/[\\/]/).at(-1) ?? ''
}

const escapeAttribute = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

export const attachmentTags = attachments => (attachments ?? [])
  .filter(item => typeof item?.name === 'string' && item.name !== '')
  .map(item => item.kind === 'image'
    ? `<attached-image path="${escapeAttribute(item.path ?? item.name)}" name="${escapeAttribute(item.name)}" />`
    : `<attached-file path="${escapeAttribute(item.path ?? item.name)}" name="${escapeAttribute(item.name)}" />`)
  .join('\n')

export const inlineTextBlocks = attachments => (attachments ?? [])
  .filter(item => item.kind === 'file' && typeof item.text === 'string' && item.text.trim() !== '')
  .map((item, index) => `<pasted-text index="${index + 1}" name="${escapeAttribute(item.title ?? item.name)}">\n${item.text}\n</pasted-text>`)
  .join('\n\n')

// 发给模型的话：原话 + 附件标记 + 文本文件正文。界面仍只显示原话。
export const withAttachments = (text, attachments) => {
  const tags = attachmentTags(attachments)
  const blocks = inlineTextBlocks(attachments)
  return [String(text ?? '').trim(), tags, blocks].filter(part => part !== '').join('\n\n')
}

const TAG = /<attached-(image|file)[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>/g
const PASTED = /<pasted-text index="\d+"(?:[\t ]+name="([^"\r\n]*)")?>\n?[\s\S]*?\n?<\/pasted-text>/g

// 目标里可以带着附件标记给模型看；界面上只显示人写的那句话。
export const stripAttachmentTags = text => splitAttachmentTags(text).text

// 回声消息里可能还带着标记：显示时拿掉，并把图片/文件还原成附件。
export const splitAttachmentTags = text => {
  const value = String(text ?? '')
  const found = []
  for (const match of value.matchAll(TAG)) {
    found.push({
      kind: match[1] === 'image' ? 'image' : 'file',
      path: match[2],
      name: match[3] || attachmentNameOf(match[2]),
    })
  }
  const stripped = value.replace(TAG, '').replace(PASTED, '').replace(/\n{3,}/g, '\n\n').trim()
  return { text: stripped, attachments: found }
}
