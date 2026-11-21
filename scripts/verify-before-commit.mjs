import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const VCS_WRITE = /(?:^|[;&|]+)\s*git(?:\s+[^\s;&|]+)*\s+(?:commit|push)\b/

export const isVcsWrite = command => VCS_WRITE.test(String(command ?? ''))

const main = () => {
  let payload = {}
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash' || !isVcsWrite(payload.tool_input?.command)) process.exit(0)

  process.stderr.write('提交前验证：npm run check:done\n')
  const result = spawnSync('npm', ['run', 'check:done'], { encoding: 'utf8' })
  if (result.status === 0) {
    process.stderr.write('提交前验证通过。\n')
    return
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  process.stderr.write(`${output.slice(-4000)}\n提交前验证没通过；已拦下 git commit / git push。\n`)
  process.exit(2)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
