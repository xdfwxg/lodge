// 主持人按话题选今晚的班底：从固定六人里请 2–6 位，每人给一句焦点。
// 只做形状和范围校验；谁更合适仍由主持模型判断。
import { sanitizeUntrusted } from '../../../../shared/untrusted-text.js'
import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

export const castPrompt = ({ room, members }) => [
  `话题：${room?.goal ?? ''}`,
  '从下面的固定班底里，选今晚真正需要的人。最多 6 位，最少 2 位。',
  '规则：',
  '- 每个被请的人只看一个问题；两个问题如果重复，就不要同时请。',
  '- 轻话题 2–3 位；普通 4 位；只有确实多出“长期”或“外部”这种不重复的镜头，才到 5–6 位。',
  '- 不要为了热闹凑人数；宁少勿多。',
  '- 每人给一句今晚的焦点，必须贴着这个话题，不能只抄他的固定问题。',
  '班底：',
  ...members.map(member => `- ${sanitizeUntrusted(member.id, 40)} | ${sanitizeUntrusted(member.name, 32)} | 固定问题：${sanitizeUntrusted(member.lens ?? member.voice ?? '', 120)}`),
  '只输出 JSON，不要解释：',
  '{"cast":[{"id":"成员id","focus":"今晚只看什么，一句话"}],"why":"为什么是这几位，一句话"}',
  INTERNAL_PROMPT_MARKER,
].join('\n')

const jsonOf = raw => {
  const source = String(raw ?? '').replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const match = source.match(/\{[\s\S]*\}/)
  if (match === null) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

// 返回 { cast: [{ id, focus }], why }，或 null（格式/范围不合规，调用方回落到 3 人）。
export const parseCast = (raw, { members, min = 2, max = 6 } = {}) => {
  const value = jsonOf(raw)
  if (value === null || !Array.isArray(value.cast)) return null
  const known = new Map((Array.isArray(members) ? members : []).map(member => [member.id, member]))
  const seen = new Set()
  const cast = []
  for (const entry of value.cast) {
    const id = text(typeof entry === 'string' ? entry : entry?.id, 40)
    if (id === '' || seen.has(id) || !known.has(id)) continue
    seen.add(id)
    cast.push({ id, focus: text(entry?.focus, 120) })
    if (cast.length >= max) break
  }
  if (cast.length < min) return null
  return { cast, why: text(value.why, 200) }
}

// 开场卡由平台从选好的班底和焦点渲染，不再让主持人额外说一段。
export const openingOf = ({ members, cast, why = '' }) => {
  const known = new Map((Array.isArray(members) ? members : []).map(member => [member.id, member]))
  const parts = cast
    .map(item => {
      const member = known.get(item.id)
      if (member === undefined) return ''
      const focus = (item.focus === '' ? (member.lens ?? '') : item.focus)
        .replace(/^(?:今晚)?(?:这轮)?只?看?/, '')
        .replace(/。$/, '')
      return `${member.name}${focus === '' ? '' : `看${focus}`}`
    })
    .filter(Boolean)
  const reason = why === '' ? '' : `（${why.replace(/。$/, '')}）`
  return `今晚请到 ${cast.length} 位：${parts.join('，')}${reason}`
}

export const fallbackCast = members => {
  const list = Array.isArray(members) ? members.slice(0, 3) : []
  return { cast: list.map(member => ({ id: member.id, focus: member.lens ?? '' })), why: '' }
}
