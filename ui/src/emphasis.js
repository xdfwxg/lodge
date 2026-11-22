const FILE = /(?<![*\w])([\w./-]+\.(?:md|markdown|json|jsonc|js|mjs|cjs|ts|tsx|jsx|css|html|txt|yml|yaml|toml|sh|py|go|rs|java))(?![*\w])/g
const LABEL = /(?<![*\w])(第 \d+ 步|完成标准|口径|阶段|待确认|下一步|风险|待处理|需要你|已交付|已通过)(?![*\w])/g

const boldPlain = text => text
  .replace(LABEL, '**$1**')
  .replace(FILE, '**$1**')

const inline = code => (FILE.test(code) ? `**${code}**` : `\`${code}\``)

// 成员已经自己用 ** 强调时保持原样；没有时只补最影响判断的词，避免整段都粗。
const mergeAdjacentBold = text => {
  let value = text
  for (let pass = 0; pass < 5 && value.includes('****'); pass += 1) {
    const next = value.replace(/\*\*([^*\n]+)\*\*\*\*([^*\n]+)\*\*/g, '**$1$2**')
    if (next === value) break
    value = next
  }
  return value
}

export const emphasizeImportant = text => {
  const value = String(text ?? '')
  if (value === '' || value.includes('**')) return value
  return mergeAdjacentBold(value
    .split(/(```[\s\S]*?```)/g)
    .map(part => {
      if (part.startsWith('```')) return part
      return part
        .split(/(`[^`\n]+`)/g)
        .map(piece => {
          if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) {
            FILE.lastIndex = 0
            return inline(piece.slice(1, -1))
          }
          return boldPlain(piece)
        })
        .join('')
    })
    .join(''))
}
