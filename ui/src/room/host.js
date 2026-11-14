// 主持人显示名由服务端随房间记录下发，UI 不自己拼名字。
export const hostLabelOf = room => room?.chatHost?.displayName ?? ''
