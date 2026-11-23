import assert from 'node:assert/strict'
import test from 'node:test'
import { existingTestChangesOf, isProtectedPath, isTestPath, protectedFilesOf } from './protected-files.js'

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

test('test files are recognized by name or directory, not by the word test', () => {
  for (const file of [
    'server/crew/store.test.js',
    'ui/src/room/health.test.js',
    'e2e/checkout.spec.mjs',
    'test/initials.js',
    'tests/fixtures/a.json',
    '__tests__/a.js',
    'pkg/initials_test.go',
    'pkg/test_initials.py',
  ]) {
    assert.equal(isTestPath(file), true, file)
  }
  for (const file of ['src/testing.js', 'docs/test.md', 'test-results/a.png', 'src/contest.js']) {
    assert.equal(isTestPath(file), false, file)
  }
})

test('only existing tests count; added tests stay free', () => {
  const diff = [
    'diff --git a/test/a.test.js b/test/a.test.js',
    'index 111..222 100644',
    '--- a/test/a.test.js',
    '+++ b/test/a.test.js',
    '@@ -1 +1 @@',
    '-expect(a()).toBe(1)',
    '+expect(a()).toBe(1)',
    'diff --git a/test/new.test.js b/test/new.test.js',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/test/new.test.js',
    'diff --git a/test/gone.test.js b/test/gone.test.js',
    'deleted file mode 100644',
    '--- a/test/gone.test.js',
    '+++ /dev/null',
    'diff --git a/src/b.js b/src/b.js',
    '--- a/src/b.js',
    '+++ b/src/b.js',
  ].join('\n')
  assert.deepEqual(
    existingTestChangesOf({ files: ['test/a.test.js', 'test/new.test.js', 'test/gone.test.js', 'src/b.js'], diff }),
    ['test/a.test.js', 'test/gone.test.js'],
  )
  // 没有 diff 的人工阶段：保守地把测试文件都算上。
  assert.deepEqual(existingTestChangesOf({ files: ['test/a.test.js', 'test/new.test.js', 'src/b.js'] }), ['test/a.test.js', 'test/new.test.js'])
  assert.deepEqual(existingTestChangesOf({ files: ['src/b.js'] }), [])
})

test('git-quoted test paths are decoded instead of skipped', () => {
  // git 默认把中文路径写成八进制转义；这类既有测试也必须进清单。
  const quoted = String.raw`\346\265\213\350\257\225.test.js`
  const diff = [
    `diff --git "a/${quoted}" "b/${quoted}"`,
    'index 111..222 100644',
    `--- "a/${quoted}"`,
    `+++ "b/${quoted}"`,
  ].join('\n')
  assert.deepEqual(existingTestChangesOf({ files: [], diff }), ['测试.test.js'])
  const added = [
    `diff --git "a/${quoted}" "b/${quoted}"`,
    'new file mode 100644',
  ].join('\n')
  assert.deepEqual(existingTestChangesOf({ files: [], diff: added }), [])
})
