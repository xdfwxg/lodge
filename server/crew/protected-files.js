// 受保护文件：依赖清单、锁文件、CI/构建配置和环境文件。
// 它们能改变整条流水线，单靠验收员“看一眼”不够；要 PASS 必须逐条确认。
const PROTECTED = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock)$/i,
  /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|Gemfile)$/i,
  /(^|\/)\.env(?:\.[^/]*)?$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.github\//i,
  /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)(Dockerfile|docker-compose\.[^/]+)$/i,
  /(^|\/)[^/]*\.config\.(?:js|mjs|cjs|ts|mts|cts)$/i,
  /(^|\/)tsconfig[^/]*\.json$/i,
  /(^|\/)\.eslintrc(?:\.[^/]*)?$/i,
  /(^|\/)scripts\/[^/]+$/i,
]

// 既有测试也是判分标准：改断言、删检查等同于改判卷的尺子。
// 新增测试不在内——补测试是正常 TDD，削弱既有检查才是要人确认的动作。
const TEST_FILE = /(^|\/)(?:[^/]+\.(?:test|spec)\.[cm]?[jt]sx?|[^/]+_test\.(?:go|py|rb)|test_[^/]+\.py)$/i
const TEST_DIR = /(^|\/)(?:__tests__|tests?)\//i

export const normalizePath = value => String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '')

export const isTestPath = value => {
  const path = normalizePath(value)
  return path !== '' && (TEST_DIR.test(path) || TEST_FILE.test(path))
}

// 从 diff 里取“既有测试”的改动；没有 diff（工作区不是 git）时保守地把测试文件都算上。
const HEADER = 'diff --git '

// git 会把空格以外的特殊路径写成 C 风格转义（中文、引号），先还原再判断。
const unquoteGitPath = token => {
  if (!token.startsWith('"')) return token
  const body = token.slice(1, token.endsWith('"') ? -1 : undefined)
  const bytes = []
  for (let at = 0; at < body.length; at += 1) {
    const ch = body[at]
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'))
      continue
    }
    const next = body[at + 1]
    if (next !== undefined && /[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(at + 1, at + 4), 8))
      at += 3
      continue
    }
    const escape = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', a: '\x07', '"': '"', '\\': '\\' }[next] ?? next ?? ''
    bytes.push(...Buffer.from(escape, 'utf8'))
    at += 1
  }
  return Buffer.from(bytes).toString('utf8')
}

const headerPaths = line => {
  const rest = line.slice(HEADER.length)
  if (!rest.startsWith('"')) {
    const match = rest.match(/^a\/(.+?) b\/(.+)$/)
    return match === null ? null : [match[1], match[2]]
  }
  let end = 1
  while (end < rest.length) {
    if (rest[end] === '\\') { end += 2; continue }
    if (rest[end] === '"') break
    end += 1
  }
  const before = unquoteGitPath(rest.slice(0, end + 1)).replace(/^a\//, '')
  const after = unquoteGitPath(rest.slice(end + 2)).replace(/^b\//, '')
  return [before, after]
}

export const existingTestChangesOf = ({ files = [], diff = '' } = {}) => {
  const text = typeof diff === 'string' ? diff : ''
  if (text === '') {
    return [...new Set((Array.isArray(files) ? files : []).map(normalizePath).filter(isTestPath))]
  }
  const changed = new Set()
  let current = null
  let added = false
  const flush = () => {
    if (current !== null && !added && isTestPath(current)) changed.add(current)
  }
  for (const line of text.split('\n')) {
    if (line.startsWith(HEADER)) {
      flush()
      const paths = headerPaths(line)
      current = paths === null ? null : normalizePath(paths[1])
      added = false
      continue
    }
    if (current !== null && line.startsWith('new file mode ')) added = true
  }
  flush()
  return [...changed]
}

export const isProtectedPath = value => {
  const path = normalizePath(value)
  return path !== '' && PROTECTED.some(pattern => pattern.test(path))
}

export const protectedFilesOf = files => (
  [...new Set((Array.isArray(files) ? files : [])
    .map(normalizePath)
    .filter(isProtectedPath))]
)
