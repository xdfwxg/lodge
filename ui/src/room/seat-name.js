// 席位显示名只从房间的 seatSpecs 取；seatNames 存的是基座 handle，不能直接上屏。
export const seatNameOf = (room, seatId) => (
  room?.seatSpecs?.find(seat => seat.id === seatId)?.name ??
  (typeof seatId === 'string' && seatId !== '' ? seatId : '')
)
