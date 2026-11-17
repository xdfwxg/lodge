// 主持人显示名由服务端的房间投影下发，UI 不读取基座字段。
export const hostLabelOf = room => room?.hostLabel ?? ''
