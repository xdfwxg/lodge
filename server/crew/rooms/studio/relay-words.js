import { memberDisplayName } from '../../member-labels.js'

// 同一条交接只 @ 一次：发送人最后一句已经点了名，就不再补系统的投影。
// 只认这个人自己的最后一句，别人的 @ 或更早的回合都不算。
export const alreadyMentioned = ({ room, messages, from, targets }) => {
  if (!Array.isArray(targets) || targets.length === 0) return false
  const lastWord = [...(messages ?? [])].reverse()
    .find(message => message.kind === 'chat' && message.authorId === from)
  if (typeof lastWord?.text !== 'string') return false
  return targets.every(target => lastWord.text.includes(`@${memberDisplayName(room, target)}`))
}
