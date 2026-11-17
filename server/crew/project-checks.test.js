import assert from 'node:assert/strict'
import test from 'node:test'
import { detectCheckCommand } from './project-checks.js'

const repo = (files = {}) => ({
  exists: path => Object.hasOwn(files, path) || Object.hasOwn(files, path.split('/').pop()),
  read: path => Buffer.from(files[path] ?? files[path.split('/').pop()] ?? ''),
})

test('a package.json test script is the check, with the matching runner', () => {
  const pkg = JSON.stringify({ scripts: { test: 'vitest run' } })
  assert.deepEqual(detectCheckCommand(repo({ 'package.json': pkg }), '/repo'), {
    command: 'npm test',
    reason: 'package.json 里有 test 脚本',
  })
  assert.equal(detectCheckCommand(repo({ 'package.json': pkg, 'pnpm-lock.yaml': '' }), '/repo').command, 'pnpm test')
  assert.equal(detectCheckCommand(repo({ 'package.json': pkg, 'yarn.lock': '' }), '/repo').command, 'yarn test')
})

test('a package.json without a test script is not a check', () => {
  assert.equal(detectCheckCommand(repo({ 'package.json': JSON.stringify({ scripts: { build: 'tsc' } }) }), '/repo'), null)
})

test('common project files map to their own check', () => {
  assert.equal(detectCheckCommand(repo({ 'Cargo.toml': '' }), '/repo').command, 'cargo test')
  assert.equal(detectCheckCommand(repo({ 'go.mod': '' }), '/repo').command, 'go test ./...')
  assert.equal(detectCheckCommand(repo({ 'pytest.ini': '' }), '/repo').command, 'pytest -q')
  assert.equal(detectCheckCommand(repo({ 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"' }), '/repo').command, 'pytest -q')
  assert.equal(detectCheckCommand(repo({ 'Makefile': 'build:\n\tgo build\ntest:\n\tgo test' }), '/repo').command, 'make test')
})

test('python without explicit pytest setup is left alone', () => {
  assert.equal(detectCheckCommand(repo({ 'pyproject.toml': '[project]\nname = "x"' }), '/repo'), null)
  assert.equal(detectCheckCommand(repo({ 'requirements.txt': 'requests' }), '/repo'), null)
})

test('an unknown repository or a missing path has no check', () => {
  assert.equal(detectCheckCommand(repo({ 'README.md': '# x' }), '/repo'), null)
  assert.equal(detectCheckCommand(repo(), ''), null)
})
