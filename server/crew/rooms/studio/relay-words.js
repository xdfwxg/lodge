import { memberDisplayName } from '../../member-labels.js'

// 同一条交接只 @ 一次：发送人已经点了名的人，不再补系统的投影。
// 只认这个人自己的最后一句；别人的 @ 或更早的回合都不算。
// 返回漏掉的目标，调用方只补漏掉的——部分点名时，已点名的人不会收到第二次 @。
const NAME_CHAR = /[\p{L}\p{N}_]/u

const mentions = (text, name) => {
  const marker = `@${name}`
  let at = text.indexOf(marker)
  while (at !== -1) {
    const next = text[at + marker.length]
    // @甲 不能命中 @甲同学；后面是空白、标点或行尾才算点了这个人。
    if (next === undefined || !NAME_CHAR.test(next)) return true
    at = text.indexOf(marker, at + marker.length)
  }
  return false
}

export const missingMentionsOf = ({ room, messages, from, targets }) => {
  if (!Array.isArray(targets) || targets.length === 0) return []
  const lastWord = [...(messages ?? [])].reverse()
    .find(message => message.kind === 'chat' && message.authorId === from)
  const text = typeof lastWord?.text === 'string' ? lastWord.text : ''
  return targets.filter(target => !mentions(text, memberDisplayName(room, target)))
}
