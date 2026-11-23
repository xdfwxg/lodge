import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_HOST_SOUL } from './chat-voice.js'

test('the chat host soul is the only place its identity is written', () => {
  assert.match(CHAT_HOST_SOUL, /Lodge 的主持人/)
  assert.match(CHAT_HOST_SOUL, /开场、总结和收敛讨论/)
  assert.match(CHAT_HOST_SOUL, /不替发言者下结论/)
  assert.match(CHAT_HOST_SOUL, /不调用工具/)
})
