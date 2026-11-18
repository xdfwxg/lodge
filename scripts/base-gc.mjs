import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { selectOrphanResources } from '../server/base-gc.js'

const dbPath = process.env.CREW_DB ?? fileURLToPath(new URL('../.data/crew.db', import.meta.url))
const baseUrl = (process.env.CREW_BASE_URL ?? 'http://127.0.0.1:8799').replace(/\/+$/, '')
const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')
const all = process.argv.includes('--all')
const help = process.argv.includes('--help') || process.argv.includes('-h')

const usage = `Lodge 基座回收

用法：
  npm run gc:base             干跑，列出会删除的旧房间 bot 和群
  npm run gc:base -- --apply  真正删除
  npm run gc:base -- --apply --force
                              当前 Lodge 没有任何房间时也清理整座基座的 Lodge 资源

只回收当前房间记录没有引用、且工作目录属于 Lodge 工作区的旧房间资源；
其他应用的 bot 和群不会碰。`

if (help) {
  console.log(usage)
  process.exit(0)
}

const db = new DatabaseSync(dbPath, { readOnly: true })
const rooms = db.prepare("SELECT payload FROM room WHERE id <> 'dispatch'").all().map(row => JSON.parse(row.payload))
db.close()

if (rooms.length === 0 && !force) {
  console.error('Lodge 当前没有房间。要清理整座基座的 Lodge 资源，加 --force。')
  process.exit(1)
}

let bootstrap
try {
  const response = await fetch(`${baseUrl}/api/bots?messages=0`, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  bootstrap = await response.json()
} catch (error) {
  console.error(`连不上基座 ${baseUrl}：${error?.message ?? error}`)
  process.exit(1)
}

const bots = bootstrap.bots ?? []
const groups = bootstrap.groups ?? []
const selected = selectOrphanResources({ rooms, bots, groups })
const { bots: deleteBots, groups: deleteGroups } = selected
const list = (items, nameOf) => (all ? items : items.slice(0, 20)).map(nameOf).filter(Boolean)
const more = items => (all || items.length <= 20 ? '' : `\n  …还有 ${items.length - 20} 个`)

console.log(`Lodge 房间 ${rooms.length} 个；基座 bot ${bots.length} 个、群 ${groups.length} 个。`)
console.log(`当前房间引用 ${selected.refs.bots.size} 个 bot、${selected.refs.groups.size} 个群。`)
console.log(`可回收：${deleteGroups.length} 个 Lodge 旧群、${deleteBots.length} 个 Lodge 旧 bot。`)
if (deleteGroups.length > 0) {
  console.log(`群：\n${list(deleteGroups, group => `  ${group.name}`).join('\n')}${more(deleteGroups)}`)
}
if (deleteBots.length > 0) {
  console.log(`bot：\n${list(deleteBots, bot => `  ${bot.name}`).join('\n')}${more(deleteBots)}`)
}
if (deleteGroups.length === 0 && deleteBots.length === 0) {
  console.log('没有需要回收的 Lodge 旧资源。')
  process.exit(0)
}
if (!apply) {
  console.log(`\n这是干跑。确认无误后运行：npm run gc:base -- --apply`)
  process.exit(0)
}

const failures = []
let removedGroups = 0
let removedBots = 0
for (const group of deleteGroups) {
  try {
    const response = await fetch(`${baseUrl}/api/groups/${encodeURIComponent(group.id)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
    removedGroups += 1
  } catch (error) {
    failures.push(`群 ${group.name}: ${error?.message ?? error}`)
  }
}
for (const bot of deleteBots) {
  try {
    const response = await fetch(`${baseUrl}/api/bots/${encodeURIComponent(bot.id)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
    removedBots += 1
  } catch (error) {
    failures.push(`bot ${bot.name}: ${error?.message ?? error}`)
  }
}

console.log(`\n已删除 ${removedGroups} 个群、${removedBots} 个 bot。`)
if (failures.length > 0) {
  console.error(`有 ${failures.length} 项没删掉：\n${failures.slice(0, 10).map(item => `  ${item}`).join('\n')}`)
  process.exit(1)
}
const after = await fetch(`${baseUrl}/api/bots?messages=0`, { signal: AbortSignal.timeout(10_000) }).then(response => response.json())
console.log(`现在基座有 ${after.bots?.length ?? '?'} 个 bot、${after.groups?.length ?? '?'} 个群。`)
