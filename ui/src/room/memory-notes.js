import { dateTimeOf } from '../view-format.js'

const short = value => (typeof value === 'string' && value.length > 12 ? value.slice(0, 12) : value)

const filesText = entry => {
  const files = Array.isArray(entry.files) ? entry.files : []
  if (files.length === 0) return ''
  const names = files.slice(0, 5).join('、')
  return files.length > 5 ? `${names} 等 ${files.length} 个` : names
}

// 记忆弹窗里先给结论，再给“上次为什么退回、当时动了哪些文件”。
export const memoryNotesOf = entry => [
  ...(Array.isArray(entry.rejections) ? entry.rejections.slice(-2) : []).map(item => {
    const stage = Number.isInteger(item?.stage) ? `（第 ${item.stage + 1} 步）` : ''
    return { kind: 'reject', text: `上次退回${stage}：${item?.reason ?? ''}` }
  }),
  filesText(entry) === '' ? null : { kind: 'files', text: `当时改过：${filesText(entry)}` },
].filter(Boolean)

export const memoryMetaOf = entry => [
  entry.completedAt === undefined || entry.completedAt === null ? '' : dateTimeOf(entry.completedAt),
  Array.isArray(entry.stages) && entry.stages.length > 0 ? `${entry.stages.length} 步` : '',
  entry.commit === null || entry.commit === undefined ? '' : short(entry.commit),
  entry.verdict === null || entry.verdict === undefined ? '' : (entry.verdict.pass === true ? '通过' : '退回'),
].filter(Boolean).join(' · ')
