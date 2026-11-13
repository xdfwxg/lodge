// 调度器发给基座的提示词不是聊天内容；基座需要它来 @ 唤醒，界面不该看见它。
export const INTERNAL_PROMPT_MARKER = '[[lodge-internal]]'

export const isInternalPrompt = text => (
  typeof text === 'string' && text.includes(INTERNAL_PROMPT_MARKER)
)
