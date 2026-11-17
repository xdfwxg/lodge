import { join } from 'node:path'

// 产品自己保证检查：从仓库里认出能跑的检查，认不出来就老实说没有。
// 只认明确的配置，不猜：猜错会跑一个跟项目无关的命令，把失败当成交付问题。
const readText = (files, path) => {
  try {
    return Buffer.from(files.read(path)).toString('utf8')
  } catch {
    return ''
  }
}

const has = (files, path) => {
  try {
    return files.exists(path) === true
  } catch {
    return false
  }
}

const json = (files, path) => {
  try {
    return JSON.parse(readText(files, path))
  } catch {
    return null
  }
}

const NODE_RUNNERS = [
  ['pnpm-lock.yaml', 'pnpm test'],
  ['yarn.lock', 'yarn test'],
  ['bun.lockb', 'bun test'],
]

export const detectCheckCommand = (files, repoPath) => {
  if (typeof repoPath !== 'string' || repoPath === '') return null
  const at = name => join(repoPath, name)

  const scripts = json(files, at('package.json'))?.scripts
  if (typeof scripts?.test === 'string' && scripts.test.trim() !== '') {
    const runner = NODE_RUNNERS.find(([lock]) => has(files, at(lock)))
    return { command: runner === undefined ? 'npm test' : runner[1], reason: 'package.json 里有 test 脚本' }
  }
  if (has(files, at('Cargo.toml'))) return { command: 'cargo test', reason: 'Rust 项目' }
  if (has(files, at('go.mod'))) return { command: 'go test ./...', reason: 'Go 项目' }
  // Python 只在明确配置了 pytest 时才跑，避免把无关目录当成测试。
  if (has(files, at('pytest.ini'))) return { command: 'pytest -q', reason: '配置了 pytest' }
  if (/\[tool\.pytest/.test(readText(files, at('pyproject.toml')))) {
    return { command: 'pytest -q', reason: '配置了 pytest' }
  }
  if (/\[tool:pytest\]/.test(readText(files, at('setup.cfg')))) {
    return { command: 'pytest -q', reason: '配置了 pytest' }
  }
  if (/^test\s*:/m.test(readText(files, at('Makefile')))) {
    return { command: 'make test', reason: 'Makefile 里有 test 目标' }
  }
  return null
}
