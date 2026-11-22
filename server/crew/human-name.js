// 用户给自己起的名字：聊天记录和提示里用它指代用户，代替“用户”和“你”。
// 名字是全局资料，不是房间字段；UI 通过资料接口改名，房间只读当前值。
const LIMIT = 20

export const cleanHumanName = value => (
  typeof value === 'string' ? value.trim().slice(0, LIMIT) : ''
)

let current = ''

export const setCurrentHumanName = value => {
  current = cleanHumanName(value)
}

export const humanNameOf = () => current

export const humanLabelOf = (fallback = '用户') => current || fallback
