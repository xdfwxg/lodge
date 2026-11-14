import { chatView } from '../room/chat/view.js'
import { studioView } from '../room/studio/view.js'
import { uiKindOfRoom } from '../room/kinds.js'

// 组合根只查表：新增一种模式 = 新建视图模块 + 这里加一项，不动聊天室和工作室。
const MODES = {
  chat: chatView,
  studio: studioView,
}

export const uiModeOfRoom = room => MODES[uiKindOfRoom(room)?.id] ?? studioView
