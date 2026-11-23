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

export const normalizePath = value => String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '')

export const isProtectedPath = value => {
  const path = normalizePath(value)
  return path !== '' && PROTECTED.some(pattern => pattern.test(path))
}

export const protectedFilesOf = files => (
  [...new Set((Array.isArray(files) ? files : [])
    .map(normalizePath)
    .filter(isProtectedPath))]
)
