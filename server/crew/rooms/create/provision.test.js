import assert from 'node:assert/strict'
import test from 'node:test'
import { pickVerifierEngine } from './provision.js'

const instance = (id, engine, available = true, images = false) => ({
  id,
  engine,
  available,
  models: { default: `${id}-model`, options: [] },
  capabilities: { images, approvalReview: true, tools: true },
})

test('the verifier gets eyes before a second vendor', () => {
  const chosen = pickVerifierEngine([
    instance('claude', 'claude', true, true),
    instance('openai', 'openai', true, false),
  ], new Set(['claude']))
  assert.equal(chosen, 'claude')
})

test('among vision instances, a different vendor still wins', () => {
  const chosen = pickVerifierEngine([
    instance('claude', 'claude', true, true),
    instance('openai', 'openai', true, true),
  ], new Set(['claude']))
  assert.equal(chosen, 'openai')
})

test('without vision, cross-vendor review stays the fallback', () => {
  const chosen = pickVerifierEngine([
    instance('claude', 'claude', true, false),
    instance('pi', 'pi', true, false),
  ], new Set(['claude']))
  assert.equal(chosen, 'pi')
})

test('unavailable instances are never chosen', () => {
  const chosen = pickVerifierEngine([
    instance('claude', 'claude', false, true),
    instance('pi', 'pi', false, true),
  ], new Set())
  assert.equal(chosen, null)
})

test('an engine that cannot run tools or ask is never picked for review', () => {
  const chosen = pickVerifierEngine([
    { ...instance('claude', 'claude', true, true), capabilities: { images: true, approvalReview: false, tools: false } },
    instance('pi', 'pi', true, false),
    instance('openai', 'openai', true, false),
  ], new Set(['pi']))
  assert.equal(chosen, 'openai', 'the tool-less engine is skipped even though it has vision')
})
