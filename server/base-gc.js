import { homedir } from 'node:os'
import { dirname, parse, resolve } from 'node:path'

// 基座是跨 Lodge 数据集常驻的；清掉 .data 后旧房间的 bot/群不会自己消失。
// 这里只回收能确认属于 Lodge 旧房间、且当前房间记录没有引用的资源。

const LODGE_STATIONS = new Set([
  '只读 · 拆阶段与派活',
  '独立副本写 · 改代码跑测试',
  '只读副本 · 只写结论',
])

const isLodgeBot = bot => {
  const name = String(bot?.name ?? '')
  return LODGE_STATIONS.has(bot?.description) ||
    name.startsWith('影子评审') ||
    name.startsWith('LodgeHost') ||
    String(bot?.soul ?? '').includes('你是 Lodge 的影子评审')
}

const underRoot = (path, roots) => (
  typeof path === 'string' && path !== '' &&
  roots.some(root => path === root || path.startsWith(`${root}/`))
)

const isLodgeGroup = (group, roots) => (
  typeof group?.name === 'string' &&
  group.name.includes(' · ') &&
  underRoot(group?.cwd, roots)
)

export const roomResourceRefs = rooms => {
  const bots = new Set()
  const groups = new Set()
  for (const room of rooms ?? []) {
    for (const member of room.members ?? []) {
      if (typeof member.body?.ref === 'string') bots.add(member.body.ref)
      if (typeof member.body?.roomRef === 'string') groups.add(member.body.roomRef)
    }
    for (const ref of [room.chatHost?.memberRef, room.shadowBot?.memberRef]) {
      if (typeof ref === 'string') bots.add(ref)
    }
    for (const ref of [room.chatHost?.roomRef, room.shadowBot?.roomRef]) {
      if (typeof ref === 'string') groups.add(ref)
    }
    if (typeof room.chatRoom?.id === 'string') groups.add(room.chatRoom.id)
  }
  return { bots, groups }
}

export const lodgeRootsOf = (rooms = [], env = process.env) => {
  const roots = new Set([
    resolve(homedir(), 'CrewWorktrees'),
    resolve(homedir(), 'CrewWorkspaces'),
  ])
  for (const name of ['CREW_WORKTREE_ROOT', 'CREW_WORKSPACE_ROOT']) {
    if (typeof env?.[name] === 'string' && env[name] !== '') roots.add(resolve(env[name]))
  }
  for (const room of rooms) {
    for (const path of [room.repoPath, room.sourceRepo]) {
      if (typeof path === 'string' && path !== '') roots.add(resolve(path))
    }
    for (const path of Object.values(room.worktrees ?? {})) {
      if (typeof path !== 'string' || path === '') continue
      const worktree = resolve(path)
      roots.add(worktree)
      // 工作区布局是 <root>/<room>/<member>；上两级就是这批工作区的根。
      const parent = dirname(dirname(worktree))
      if (parent !== parse(parent).root) roots.add(parent)
    }
  }
  return [...roots]
}

// 只删两类 Lodge 资源：
// 1. 旧房间自己的群，且群里没有当前房间还在用的 bot；
// 2. 不在任何保留群里的旧成员、影子评审或主持 bot。
// 数据被清空后的首次启动：把基座里所有 Lodge 资源退掉，别的应用不动。
export const clearLodgeBaseResources = async (client, { env = process.env } = {}) => {
  const bootstrap = await client.bootstrap()
  const selected = selectOrphanResources({
    rooms: [],
    bots: bootstrap.bots ?? [],
    groups: bootstrap.groups ?? [],
    env,
  })
  let bots = 0
  let groups = 0
  const failures = []
  for (const group of selected.groups) {
    try {
      await client.deleteGroup(group.id)
      groups += 1
    } catch (error) {
      failures.push(`${group.name}: ${error?.message ?? error}`)
    }
  }
  for (const bot of selected.bots) {
    try {
      await client.deleteBot(bot.id)
      bots += 1
    } catch (error) {
      failures.push(`${bot.name}: ${error?.message ?? error}`)
    }
  }
  return { bots, groups, failures }
}

export const selectOrphanResources = ({ rooms, bots = [], groups = [], env = process.env }) => {
  const refs = roomResourceRefs(rooms)
  const roots = lodgeRootsOf(rooms, env)
  const candidates = groups.filter(group => (
    !refs.groups.has(group.id) && isLodgeGroup(group, roots)
  ))
  const deletableGroups = candidates.filter(group => (
    !(group.memberIds ?? []).some(id => refs.bots.has(id))
  ))
  const deletableGroupIds = new Set(deletableGroups.map(group => group.id))
  const survivingGroups = groups.filter(group => !deletableGroupIds.has(group.id))
  const survivingMembers = new Set(survivingGroups.flatMap(group => group.memberIds ?? []))
  const deletedMembers = new Set(deletableGroups.flatMap(group => group.memberIds ?? []))
  const deleteBots = bots.filter(bot => (
    !refs.bots.has(bot.id) &&
    !survivingMembers.has(bot.id) &&
    (deletedMembers.has(bot.id) || isLodgeBot(bot))
  ))
  return {
    bots: deleteBots,
    groups: deletableGroups,
    roots,
    refs,
  }
}
