// 执行阶段的方法硬约束：命令验收的阶段，改代码就要带测试改动。
// 不判断测试写得好不好，只判断“有没有先补一个会红的测试”。
const TEST_FILE = /(^|\/)(__tests__|tests?|spec)(\/|$)|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rb|rs)$/i
const SOURCE_FILE = /\.(c|cc|cpp|cs|ex|exs|go|java|js|jsx|kt|kts|mjs|cjs|php|py|rb|rs|swift|ts|tsx|vue|svelte)$/i
const NOT_CODE = /(^|\/)(docs?|examples?|fixtures?|scripts?)(\/|$)|(^|\/)(README|CHANGELOG|LICENSE)[^/]*$|\.(md|txt|json|jsonc|ya?ml|toml|lock)$/i
const TEST_RUNNER = /(^|[\s;&|(])(npm (run )?test|pnpm (run )?test|yarn (run )?test|bun test|node --test|pytest|go test|cargo test|jest|vitest|mocha|phpunit|rspec|make test)(\s|$)/i

const filesOf = evidence => {
  const meta = evidence?.meta ?? {}
  if (Array.isArray(meta.changedFiles)) return meta.changedFiles
  return Array.isArray(meta.files) ? meta.files : []
}

export const tddIssueOf = (stage, evidence) => {
  const acceptance = typeof stage?.acceptance === 'string' ? stage.acceptance.trim() : ''
  if (!TEST_RUNNER.test(acceptance)) return ''
  if (evidence?.meta?.simulated === true) return ''
  const files = filesOf(evidence).filter(file => typeof file === 'string' && file !== '')
  if (files.length === 0) return ''
  const code = files.filter(file => SOURCE_FILE.test(file) && !TEST_FILE.test(file) && !NOT_CODE.test(file))
  if (code.length === 0) return ''
  if (files.some(file => TEST_FILE.test(file))) return ''
  return `这一步改了 ${code.length} 个代码文件，但没有测试改动；先补一个会先失败的测试，再交验收`
}
