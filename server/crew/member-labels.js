import { memberLabelMap, memberOf } from './room-members.js'

export { memberLabelMap }

// 房间用成员名，基座用身体名；两者只在跨边界时转换。
export const memberDisplayName = (room, memberId) => memberOf(room, memberId)?.name ?? memberId

export const memberSurfaceName = (room, memberId) => {
  const name = memberOf(room, memberId)?.body?.name
  return typeof name === 'string' ? name.trim() : ''
}

// 传输层用：成员在基座里的地址是身体名 + 身体引用；缺一个就不能投递。
export const memberAddress = (room, memberId) => {
  const name = memberSurfaceName(room, memberId)
  const memberRef = memberOf(room, memberId)?.body?.ref
  if (name === '' || typeof memberRef !== 'string' || memberRef === '') return null
  return { name, mention: `@${name}`, memberRef }
}

export const hostAddress = room => {
  const name = room?.chatHost?.name
  const memberRef = room?.chatHost?.memberRef
  if (typeof name !== 'string' || name === '' || typeof memberRef !== 'string' || memberRef === '') return null
  return { name, mention: `@${name}`, memberRef }
}

const replaceAll = (text, from, to) => {
  if (typeof text !== 'string' || text === '' || from === '' || from === to) return text
  return text.split(from).join(to)
}

export const LODGE_HOST_LABEL = 'Lodge 主持'

const hostBaseNameOf = room => {
  const name = room?.chatHost?.name
  return typeof name === 'string' && name !== '' ? name : ''
}

const hostDisplayNameOf = room => (
  typeof room?.chatHost?.displayName === 'string' ? room.chatHost.displayName : ''
)

export const toBaseMentions = (room, text) => {
  let output = text
  for (const member of room?.members ?? []) {
    const baseName = member?.body?.name
    if (typeof baseName !== 'string' || baseName === '' || baseName === member.name) continue
    output = replaceAll(output, `@${member.name}`, `@${baseName}`)
  }
  return output
}

const MENTION_TOKEN = /@([\p{L}\p{N}._-]+)/gu

// 人写的 @ 如果找不到成员，基座不会替我们猜；这里只负责把没送到的名字告诉人。
export const unknownMentionsOf = (room, text) => {
  const known = new Set(['所有人', 'everyone'])
  for (const member of room?.members ?? []) {
    if (typeof member.name === 'string' && member.name !== '') known.add(member.name)
    if (typeof member.body?.name === 'string' && member.body.name !== '') known.add(member.body.name)
  }
  if (typeof room?.chatHost?.name === 'string') known.add(room.chatHost.name)
  if (typeof room?.chatHost?.displayName === 'string') known.add(room.chatHost.displayName)
  const unknown = []
  for (const match of String(text ?? '').matchAll(MENTION_TOKEN)) {
    const name = match[1]
    if (known.has(name) || unknown.includes(name)) continue
    unknown.push(name)
  }
  return unknown
}

export const toDisplayMentions = (room, text) => {
  let output = text
  for (const member of room?.members ?? []) {
    const baseName = member?.body?.name
    if (typeof baseName !== 'string' || baseName === '' || baseName === member.name) continue
    output = replaceAll(output, `@${baseName}`, `@${member.name}`)
  }
  const host = hostBaseNameOf(room)
  const label = hostDisplayNameOf(room)
  return host === '' || label === '' ? output : replaceAll(output, `@${host}`, `@${label}`)
}

// 前端看到的文本统一用成员名，连基座反馈里没带 @ 的成员名也换掉。
export const toDisplayText = (room, text) => {
  let output = toDisplayMentions(room, text)
  for (const member of room?.members ?? []) {
    const baseName = member?.body?.name
    if (typeof baseName !== 'string' || baseName === '' || baseName === member.name) continue
    output = replaceAll(output, baseName, member.name)
  }
  const host = hostBaseNameOf(room)
  const label = hostDisplayNameOf(room)
  return host === '' || label === '' ? output : replaceAll(output, host, label)
}
