import assert from 'node:assert/strict'
import test from 'node:test'
import { availableEngines, modelBlockReason, resolveEngine } from './engine-readiness.js'

const pi = {
  id: 'pi',
  available: true,
  authenticated: true,
  models: { default: 'deepseek/deepseek-flash', options: [{ id: 'deepseek/deepseek-flash' }] },
}
const claude = { id: 'claude', available: false, models: { default: '', options: [] } }

test('an engine is found by its instance id', () => {
  assert.equal(resolveEngine([pi, claude], 'pi', '')?.id, 'pi')
})

test('a vendor name resolves when exactly one instance offers that model', () => {
  assert.equal(resolveEngine([pi, claude], 'anthropic', 'deepseek/deepseek-flash')?.id, 'pi')
})

test('an unknown model and vendor stay unresolved', () => {
  assert.equal(resolveEngine([pi, claude], 'anthropic', 'claude-sonnet-4-5-20250929'), undefined)
})

test('the available list names instances and their models', () => {
  assert.equal(availableEngines([pi, claude]), 'pi · deepseek/deepseek-flash')
})

test('a model outside the instance options is refused with the real list', () => {
  assert.equal(modelBlockReason(pi, 'deepseek/deepseek-flash'), '')
  assert.match(modelBlockReason(pi, 'claude-sonnet-4-5-20250929'), /pi 可用：deepseek\/deepseek-flash/)
})

test('an instance without a declared list does not pretend to validate', () => {
  assert.equal(modelBlockReason({ id: 'x', models: { options: [] } }, 'anything'), '')
})
