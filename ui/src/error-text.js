import { copyIssueOf } from '../../shared/product-copy.js'

// 业务错误本来就是给人看的；内部词、英文底层错误一律换成固定的话。
const CJK = /[一-鿿]/

export const humanErrorText = (error, fallback = 'Lodge 没连上，稍后自动重试') => {
  const text = String(error ?? '').trim()
  return text === '' || !CJK.test(text) || copyIssueOf(text) !== null ? fallback : text
}

// 拼在句子后面：中文的业务原因保留，英文或内部词不露出来。
export const errorSuffix = error => {
  const text = String(error ?? '').trim()
  return CJK.test(text) && copyIssueOf(text) === null ? `：${text}` : ''
}
