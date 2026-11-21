import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import { copyIssueOf, copyStringsInSource } from '../../shared/product-copy.js'

// 这些文件里的中文全部是给人看的错误、提示或状态，没有模型提示词。
const PURE_COPY_FILES = new Set([
  'base-error.js',
  'attention.js',
  'notices.js',
  'member-delivery.js',
  'member-remove.js',
  'body-change.js',
  'body-spec.js',
  'surfaces/base.js',
])

const walk = directory => {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(path)
  }
  return files
}

test('messages written into a room avoid internal words', () => {
  const root = join(process.cwd(), 'server/crew')
  const issues = []
  for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8')
    const pure = PURE_COPY_FILES.has(relative(root, file))
    const items = pure
      ? copyStringsInSource(source, { quoted: true })
      : copyStringsInSource(source, { quoted: false, fields: ['text'] })
    for (const item of items) {
      const issue = copyIssueOf(item.text)
      if (issue !== null) issues.push(`${relative(process.cwd(), file)}:${item.line} ${issue} · ${item.text}`)
    }
  }
  assert.deepEqual(issues, [])
})
