// 成员用一行隐藏标记说明发言意图；界面只看到去掉标记后的正文。
const FLOOR = /\[\[lodge-floor\s*(\{[\s\S]*?\})\]\]/i

export const FLOOR_RULE = '回复末尾单独加一行 [[lodge-floor {"action":"want"}]] 表示想补充；让给某人写 {"action":"pass","to":"对方名字"}；本轮只听写 {"action":"listen"}。这一行不会显示给人。'

export const parseFloorSignal = text => {
  const raw = String(text ?? '')
  const match = raw.match(FLOOR)
  if (match === null) return { text: raw, action: '', to: '' }
  let data = null
  try {
    data = JSON.parse(match[1])
  } catch {
    data = null
  }
  const action = data?.action === 'pass' || data?.action === 'listen' || data?.action === 'want'
    ? data.action
    : ''
  const to = action === 'pass' && typeof data?.to === 'string' ? data.to.trim() : ''
  return {
    text: raw.replace(match[0], '').replace(/\n{3,}/g, '\n\n').trimEnd(),
    action,
    to,
  }
}

export const stripFloorSignal = text => parseFloorSignal(text).text
