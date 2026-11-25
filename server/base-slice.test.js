import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createEngine } from './engine.js'
import { RUNTIME_METHODS, RUNTIME_NAMESPACES } from './crew/runtime-port.js'

// The base may serve more products, but Lodge may only call this slice (docs/architecture.md「基座切片」).
// Adding a new endpoint or port method is a contract decision, not a convenience.
const SLICE = [
  /^\/api\/attachments(\/|$)/,
  /^\/api\/bots(\/|\?|$)/,
  /^\/api\/config$/,
  /^\/api\/events$/,
  /^\/api\/files(\?|$)/,
  /^\/api\/groups(\/|$)/,
  /^\/api\/instances$/,
  /^\/api\/mcp\/servers(\/|$)/,
  /^\/api\/skills-library(\/|$)/,
  /^\/api\/threads\//,
]

const endpointsOf = source => [...source.matchAll(/['"`](\/api\/[a-zA-Z0-9_/${}.:?-]*)/g)]
  .map(match => match[1].replace(/\$\{[^}]*\}/g, ':id'))

test('the base client only calls the slice Lodge depends on', () => {
  const source = readFileSync(new URL('./base.js', import.meta.url), 'utf8')
  const outside = endpointsOf(source).filter(path => !SLICE.some(prefix => prefix.test(path)))
  assert.deepEqual([...new Set(outside)], [])
})

test('the real engine adapter implements every runtime port method', () => {
  const engine = createEngine({ client: {} })
  for (const name of RUNTIME_METHODS) assert.equal(typeof engine[name], 'function', name)
  for (const [namespace, methods] of Object.entries(RUNTIME_NAMESPACES)) {
    for (const name of methods) assert.equal(typeof engine[namespace]?.[name], 'function', `${namespace}.${name}`)
  }
})
