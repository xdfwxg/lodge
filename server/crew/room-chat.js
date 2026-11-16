// 房间聊天是基座原生群聊：所有成员都在同一个对话线程里，@ 只是点名，
// 真正的执行由阶段派发完成。这里只放跨建房/重连共享的常量。
export const ROOM_CHAT_BULLETIN = [
  '这是房间里的对话：直接、简短地回答用户和同伴。',
  '@名字可以点名成员；真正的执行和验收由 Lodge 的派发与阶段完成，聊天本身不产出交付。',
].join('\n')

export const roomChatName = title => `${title} · 房间聊天`

// 聊天室只放聊天内容；建房、仓库、引擎降级、Gate 建议这些工作室信息不进聊天时间线。
const CHAT_SYSTEM_NOISE = [
  /^房间已创建 · 聊天室/,
  /^聊天室：先讨论/,
  /^源仓库 /,
  /^引擎降级：/,
  /^Gate·评估建议/,
]

export const isChatSystemNoise = message => (
  message?.kind === 'system' && CHAT_SYSTEM_NOISE.some(pattern => pattern.test(String(message.text ?? '')))
)
