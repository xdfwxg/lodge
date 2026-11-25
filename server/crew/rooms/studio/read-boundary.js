// 验收员只能拿自己复核副本里的东西当证据；读或跑到别人副本、集成目录里，
// 就算看到了正确结果，也不是这次交付的现场。这里从工具调用里找出这些绝对路径。
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { actionForTool } from '../../../../shared/tool-action.js'
import { isWithin } from '../../workspace-paths.js'

const textOf = call => [
  call?.step?.target,
  call?.step?.detail,
  call?.target,
  call?.detail,
  call?.input?.file_path,
  call?.input?.path,
  call?.input?.command,
  typeof call?.input === 'string' ? call.input : '',
]
  .filter(value => typeof value === 'string' && value.trim() !== '')
  .join(' ')

const pathTokensOf = call => (
  textOf(call)
    .replaceAll('\\', '/')
    .split(/[\s"'`,;()<>|&]+/)
    .map(token => token.replace(/^[A-Za-z0-9_-]+=/, ''))
    // 绝对路径、~/，以及带 .. 的相对穿越；普通相对路径按自己的副本解释。
    .filter(token => token.startsWith('/') || token.startsWith('~/') || token.includes('..'))
)

const absolutePathOf = (token, ownPath) => (
  token.startsWith('~/')
    ? resolve(homedir(), token.slice(2))
    : token.startsWith('/')
      ? resolve(token)
      : resolve(ownPath, token)
)

export const foreignReadsOf = ({ calls, room, memberId, membersOnly = false }) => {
  const own = room?.worktrees?.[memberId] ?? room?.repoPath ?? ''
  if (typeof own !== 'string' || own === '') return []
  const ownPath = resolve(own)
  const roots = new Map()
  const addRoot = (name, path) => {
    if (typeof path !== 'string' || path === '') return
    const target = resolve(path)
    if (target === ownPath || roots.has(target)) return
    roots.set(target, name)
  }
  // 回合中对账只看别人的工作副本；集成目录和源仓库可能是执行时需要对照的现场。
  if (!membersOnly) {
    addRoot('集成目录', room?.repoPath)
    addRoot('源仓库', room?.sourceRepo)
  }
  for (const [id, path] of Object.entries(room?.worktrees ?? {})) {
    if (id !== memberId) addRoot(id, path)
  }
  const hits = []
  const seen = new Set()
  for (const call of Array.isArray(calls) ? calls : []) {
    const action = actionForTool(call?.name)
    if (action !== 'read' && action !== 'exec') continue
    for (const token of pathTokensOf(call)) {
      const target = absolutePathOf(token, ownPath)
      if (isWithin(ownPath, target)) continue
      for (const [root, name] of roots) {
        if (!isWithin(root, target)) continue
        const key = `${target}:${name}`
        if (seen.has(key)) continue
        seen.add(key)
        hits.push({ path: target, root: name, tool: String(call?.name ?? '') })
      }
    }
  }
  return hits
}
