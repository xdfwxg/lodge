import assert from 'node:assert/strict'
import test from 'node:test'
import { isProtectedPath, protectedFilesOf } from './protected-files.js'

test('dependency, CI and environment files are protected', () => {
  for (const file of [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    '.github/workflows/test.yml',
    '.env',
    '.env.local',
    'vite.config.js',
    'tsconfig.build.json',
    'scripts/release.sh',
    'Dockerfile',
    'nested/dir/package.json',
  ]) {
    assert.equal(isProtectedPath(file), true, file)
  }
})

test('ordinary source and test files are not protected', () => {
  for (const file of ['src/initials.js', 'test/initials.test.js', 'README.md', 'docs/design.md']) {
    assert.equal(isProtectedPath(file), false, file)
  }
})

test('the list is normalized and deduplicated', () => {
  assert.deepEqual(
    protectedFilesOf(['./package.json', 'package.json', 'src/a.js', '.github/ci.yml']),
    ['package.json', '.github/ci.yml'],
  )
})
