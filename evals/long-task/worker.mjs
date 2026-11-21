import { createStore } from '../../server/crew/store.js'
import { reconcileRounds } from '../../server/crew/rounds/recovery.js'
import { SCENARIOS } from './scenarios.mjs'

const args = process.argv.slice(2)
const option = name => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const caseId = option('--case')
const phase = option('--phase')
const dataDir = option('--data-dir')
const repo = option('--repo')
const scenario = SCENARIOS[caseId]

if (scenario === undefined || !['first', 'second'].includes(phase) || !dataDir) {
  console.error('用法：node evals/long-task/worker.mjs --case <id> --phase first|second --data-dir <dir> --repo <path>')
  process.exit(2)
}

let store = null
try {
  store = createStore({ dataDir })
  if (phase === 'second') {
    // 新进程打开同一个库：先修轮次指针，再回收过期租约，然后继续。
    reconcileRounds({ store, emit: () => {} })
    store.reclaimWork?.()
  }
  const result = await scenario[phase]({ store, repo })
  console.log(JSON.stringify({ ok: true, ...(result ?? {}) }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
  process.exitCode = 1
} finally {
  try { store?.db.close() } catch {}
}
