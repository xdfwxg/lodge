// 引擎级错误的分类与文案：运行中的暂停和建房前的身体体检共用一份判断。
export const isMemberFailureText = text => /^error:\s/i.test(String(text ?? ''))

export const memberFailureKind = text => {
  const lower = String(text ?? '').toLowerCase()
  if (lower.includes('余额') || lower.includes('insufficient') || lower.includes('quota') || lower.includes('credit')) return 'quota'
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('invalid api key')) return 'auth'
  if (lower.includes('429') || lower.includes('rate_limit') || lower.includes('rate limit')) return 'rate_limit'
  return 'engine'
}

export const failureCopy = (kind, name) => ({
  quota: `${name}的模型额度用完了，房间已暂停。充值或给这位成员换个模型后，点“继续”。`,
  auth: `${name}的登录失效了，房间已暂停。重新登录或换个模型服务后，点“继续”。`,
  rate_limit: `${name}被模型服务限流了，房间已暂停。稍后点“继续”，或给这位成员换个模型。`,
  engine: `${name}没能回应，房间已暂停。检查模型服务设置后，点“继续”。`,
}[kind])
