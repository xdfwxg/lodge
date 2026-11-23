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

// 从 diff 里取“既有测试”的改动；没有 diff（人工验收）时保守地把测试文件都算上。
const TEST_DIFF_LINE = /^diff --git a\/(.+?) b\/(.+)$/

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
    const match = line.match(TEST_DIFF_LINE)
    if (match !== null) {
      flush()
      current = normalizePath(match[2])
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
