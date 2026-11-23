// 历史检索的查询词：中文没有空格，按 3 字滑窗切；英文按词切 3 字片段。
// 只负责“拿什么去查”，不判断语义；结果按匹配数排序，交给人读。
const RUN = /[\p{L}\p{N}]+/gu

export const searchTerms = query => {
  const runs = String(query ?? '').match(RUN) ?? []
  const terms = []
  for (const run of runs) {
    const chars = [...run]
    if (chars.length >= 3) {
      for (let at = 0; at + 3 <= chars.length && terms.length < 24; at += 1) {
        terms.push(chars.slice(at, at + 3).join(''))
      }
    } else if (chars.length > 0) {
      terms.push(run)
    }
  }
  return [...new Set(terms)]
}

export const clipText = (text, max = 4000) => {
  const value = String(text ?? '')
  return value.length > max ? value.slice(0, max) : value
}
