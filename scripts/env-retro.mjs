import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sourceFile = file => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !/(^|\/)test\//.test(file)
const testFile = file => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || /(^|\/)test\//.test(file)
const docsFile = file => /^docs\//.test(file) || /^(Lodge|README|AGENTS)\.md$/.test(file)

export const retroOf = ({
  changedFiles = [],
  diffCheck = '',
  uncommitted = 0,
  packageChanged = false,
} = {}) => {
  const items = []
  const sources = changedFiles.filter(sourceFile)
  const tests = changedFiles.filter(testFile)
  const docs = changedFiles.filter(docsFile)
  if (diffCheck.trim() !== '') {
    items.push({
      severity: 'high',
      title: '改动里有空白错误或冲突标记',
      fix: '把 git diff --check 加进提交前检查，先让机械错误变成确定性检查。',
    })
  }
  if (sources.length > 0 && tests.length === 0) {
    items.push({
      severity: 'high',
      title: `${sources.length} 个源文件改动，没有测试改动`,
      fix: '先补一个能失败的测试；没有测试的改动至少补一条验收命令。',
    })
  }
  if (changedFiles.some(file => /^server\/|^shared\//.test(file)) && docs.length === 0) {
    items.push({
      severity: 'medium',
      title: '服务端或共享契约改动没有同步文档',
      fix: '把行为、接口或边界的变化写进 docs/architecture.md 或 Lodge.md。',
    })
  }
  if (packageChanged) {
    items.push({
      severity: 'medium',
      title: 'package.json 变了',
      fix: '检查新增脚本是否写进文档，并确认 CI 和本地命令走同一条路。',
    })
  }
  if (changedFiles.length > 15) {
    items.push({
      severity: 'medium',
      title: `一次改了 ${changedFiles.length} 个文件`,
      fix: '把改动拆成能单独验收的几块；如果它们必须一起落地，在 PR 里写清原因。',
    })
  }
  if (uncommitted > 0) {
    items.push({
      severity: 'low',
      title: `工作区还有 ${uncommitted} 个未提交改动`,
      fix: '先提交或明确留下，别让下一次改动和这一批混在一起。',
    })
  }
  return items.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]))
}

const git = (args, options = {}) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
  } catch {
    return ''
  }
}

const changedSince = since => {
  const args = since === '' ? ['diff', '--name-only', 'HEAD'] : ['diff', '--name-only', `${since}...HEAD`]
  const tracked = git(args).split('\n').map(line => line.trim()).filter(Boolean)
  const status = git(['status', '--porcelain']).split('\n').map(line => line.slice(3).trim()).filter(Boolean)
  return [...new Set([...tracked, ...status])]
}

export const renderRetro = items => [
  '# Lodge environment retro',
  '',
  ...(items.length === 0
    ? ['环境没有明显缺口。继续把重复出现的机械错误变成检查。']
    : items.flatMap(item => [
      `- **${item.severity}** ${item.title}`,
      `  - 改法：${item.fix}`,
    ])),
  '',
].join('\n')

const main = () => {
  const sinceIndex = process.argv.indexOf('--since')
  const since = sinceIndex >= 0 ? process.argv[sinceIndex + 1] ?? '' : ''
  const changedFiles = changedSince(since)
  const items = retroOf({
    changedFiles,
    diffCheck: git(['diff', '--check']),
    uncommitted: git(['status', '--porcelain']).split('\n').filter(Boolean).length,
    packageChanged: changedFiles.includes('package.json'),
  })
  process.stdout.write(renderRetro(items))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
