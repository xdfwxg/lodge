import { failureCopy } from '../../shared/failure.js'

export { failureCopy }

// 引擎级错误的分类：运行中的暂停和建房前的身体体检共用一份判断。
export const isMemberFailureText = text => /^error:\s/i.test(String(text ?? ''))

export const memberFailureKind = text => {
  const lower = String(text ?? '').toLowerCase()
  if (lower.includes('余额') || lower.includes('insufficient') || lower.includes('quota') || lower.includes('credit')) return 'quota'
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('invalid api key')) return 'auth'
  if (lower.includes('429') || lower.includes('rate_limit') || lower.includes('rate limit')) return 'rate_limit'
  return 'engine'
}
