import { execFile } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { promisify } from 'node:util'
import { openablePath as policyOf } from '../shared/system-policy.js'

const openablePath = target => policyOf(target, { stat: statSync, realpath: realpathSync })

const run = promisify(execFile)

export const openPath = async target => {
  const verdict = openablePath(target)
  if (!verdict.ok) throw new Error(verdict.error)
  const path = verdict.path
  const directory = statSync(path).isDirectory()
  if (process.platform === 'darwin') {
    await run('open', directory ? ['-a', 'Finder', path] : [path], { timeout: 10_000 })
    return
  }
  await run(process.platform === 'win32' ? 'explorer' : 'xdg-open', [path], { timeout: 10_000 })
}
