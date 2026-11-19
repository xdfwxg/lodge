// 用户给自己起的名字：聊天记录和提示里用它指代用户，代替“用户”和“你”。
// UI 把名字随消息一起送上来；这里只做清洗，不判断名字好不好。
const LIMIT = 20

export const cleanHumanName = value => (
  typeof value === 'string' ? value.trim().slice(0, LIMIT) : ''
)

export const humanNameOf = room => cleanHumanName(room?.humanName)

export const humanLabelOf = (room, fallback = '用户') => humanNameOf(room) || fallback
