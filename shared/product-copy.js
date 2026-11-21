// 用户能看到的词只有这一套。新增状态先加进 STATUS_LABELS，再写进界面。
export const STATUS_LABELS = Object.freeze([
  '待处理',
  '进行中',
  '已完成',
  '已交付',
  '已确认',
  '已暂停',
  '已停止',
  '已归档',
  '待确认',
  '待回答',
  '待重做',
  '待处理冲突',
  '验收员在看',
  '看结果',
  '补检查',
  '可以继续',
  '没做成',
  '连接中断',
])

// 主界面不出现的内部词。中文按包含匹配，英文按整词匹配。
const CJK_TERMS = ['席位', '引擎', '基座', '产物', '返工', '审批', '编排']
const LATIN_TERMS = ['MCP', 'worktree', 'diff', 'commit', 'verdict', 'gate', 'runtime', 'adapter', 'schema']

// 状态位不是第二人称通知。
const BANNED_PATTERNS = [/需要你/, /该你了/, /请处理/]

const latinWord = term => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)

export const copyIssueOf = value => {
  const text = String(value ?? '')
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(text)) return `第二人称状态：${pattern.source}`
  }
  for (const term of CJK_TERMS) {
    if (text.includes(term)) return `内部词：${term}`
  }
  for (const term of LATIN_TERMS) {
    if (latinWord(term).test(text)) return `内部词：${term}`
  }
  return null
}

// 模板里的表达式不是文案，检查前先去掉。
export const stripExpressions = value => {
  let out = ''
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (depth === 0 && char === '$' && value[index + 1] === '{') {
      depth = 1
      index += 1
      continue
    }
    if (depth > 0) {
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      continue
    }
    out += char
  }
  return out
}

const hasCjk = value => /[一-鿿]/.test(value)

// 从源码里取用户能看到的字符串：带中文的引号字符串、JSX 文本、指定的字段（如 text:）。
export const copyStringsInSource = (source, { jsxText = false, fields = [], quoted = true } = {}) => {
  const withoutBlocks = String(source).replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ''))
  const found = []
  withoutBlocks.split('\n').forEach((line, index) => {
    if (/^\s*(\/\/|\*)/.test(line)) return
    const values = []
    if (quoted) {
      for (const match of line.matchAll(/['"`]([^'"`\n]*[一-鿿][^'"`\n]*)['"`]/g)) values.push(match[1])
    }
    if (jsxText) {
      for (const match of line.matchAll(/>\s*([^<>{}]*[A-Za-z一-鿿][^<>{}]*)\s*</g)) values.push(match[1].trim())
    }
    for (const field of fields) {
      const pattern = new RegExp(`${field}:\\s*(['"\`])([^'"\`\\n]*[一-鿿][^'"\`\\n]*)\\1`, 'g')
      for (const match of line.matchAll(pattern)) values.push(match[2])
    }
    for (const value of values) {
      const text = stripExpressions(value).trim()
      if (text === '' || !hasCjk(text)) continue
      found.push({ line: index + 1, text })
    }
  })
  return found
}
