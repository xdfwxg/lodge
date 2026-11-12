import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDelivery } from './delivery.js'

const ledgerFile = dataDir => join(dataDir, 'deliveries.json')
const keyOf = item => `${item.roomId ?? ''}|${item.commit ?? item.completedAt ?? ''}`

const clean = item => {
  if (item === null || typeof item !== 'object') return null
  if (typeof item.roomId !== 'string' || item.roomId === '') return null
  if (typeof item.name !== 'string' || item.name === '') return null
  return {
    roomId: item.roomId,
    name: item.name.slice(0, 120),
    goal: typeof item.goal === 'string' ? item.goal.slice(0, 500) : '',
    completedAt: Number.isFinite(item.completedAt) ? item.completedAt : null,
    commit: typeof item.commit === 'string' && item.commit !== '' ? item.commit.slice(0, 80) : null,
    stages: Number.isFinite(item.stages) ? item.stages : 0,
    commands: Number.isFinite(item.commands) ? item.commands : 0,
    changedFiles: Number.isFinite(item.changedFiles) ? item.changedFiles : 0,
    importedAt: Date.now(),
  }
}

export const readImportedDeliveries = dataDir => {
  const file = ledgerFile(dataDir)
  if (!existsSync(file)) return []
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(data) ? data.map(clean).filter(Boolean) : []
  } catch {
    return []
  }
}

export const deliveryBundle = (rooms, readMessages = () => []) => ({
  version: 'lodge.deliveries.v1',
  generatedAt: Date.now(),
  deliveries: rooms
    .filter(room => room.state === 'complete')
    .map(room => {
      const delivery = buildDelivery(room, readMessages(room.id))
      return {
        roomId: room.id,
        name: room.name,
        goal: room.goal,
        completedAt: delivery.completedAt,
        commit: delivery.commit,
        stages: delivery.stages.length,
        commands: delivery.commands.length,
        changedFiles: delivery.changedFiles.length,
      }
    }),
})

export const importDeliveries = ({ dataDir, bundle }) => {
  if (bundle === null || typeof bundle !== 'object' || !Array.isArray(bundle.deliveries)) {
    throw new Error('交付摘要缺少 deliveries 数组')
  }
  if (bundle.deliveries.length > 500) throw new Error('一次最多导入 500 条交付摘要')
  const merged = new Map(readImportedDeliveries(dataDir).map(item => [keyOf(item), item]))
  for (const raw of bundle.deliveries) {
    const item = clean(raw)
    if (item !== null) merged.set(keyOf(item), item)
  }
  const items = [...merged.values()]
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, 500)
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(ledgerFile(dataDir), JSON.stringify(items, null, 2))
  return items
}
