// 用户给自己起的名字：聊天记录和提示里用它指代用户，代替“用户”和“你”。
// UI 把名字随消息一起送上来；这里只做清洗，不判断名字好不好。
const LIMIT = 20

export const cleanHumanName = value => (
  typeof value === 'string' ? value.trim().slice(0, LIMIT) : ''
)

// 当前用户是整个产品的资料，不是房间自己的字段。
// 服务启动时把全局资料设进来；没设过时才回退到旧房间里的临时副本。
let current = { name: '', loaded: false }

export const setCurrentHumanName = (value, { loaded = true } = {}) => {
  current = { name: cleanHumanName(value), loaded }
}

export const humanNameOf = room => (
  current.loaded ? current.name : cleanHumanName(room?.humanName)
)

export const humanLabelOf = (room, fallback = '用户') => humanNameOf(room) || fallback
