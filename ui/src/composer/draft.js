// 输入框的纯文本状态：@ 匹配与每间房的草稿。没有 React，也没有上传。
export const mentionAt = (value, cursor) => {
  const before = value.slice(0, cursor)
  const match = before.match(/(^|\s)@([^\s@]*)$/)
  if (match === null) return null
  const start = before.lastIndexOf('@')
  return { start, end: cursor, query: match[2] }
}

export const draftKeyOf = key => `lodge:draft:${key}`

export const readDraft = key => {
  if (key === '') return ''
  try { return globalThis.localStorage?.getItem(draftKeyOf(key)) ?? '' } catch { return '' }
}

export const writeDraft = (key, value) => {
  if (key === '') return
  try {
    if (value === '') globalThis.localStorage?.removeItem(draftKeyOf(key))
    else globalThis.localStorage?.setItem(draftKeyOf(key), value)
  } catch {}
}
