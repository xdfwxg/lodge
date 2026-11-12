import * as archive from './archive.js'
import * as roundtable from './roundtable.js'
import * as task from './task.js'

export const roomTypeStrategies = [task, roundtable, archive]
export const defaultRoomTypeId = task.id

export const resolveRoomType = value => {
  if (value === undefined || value === null || value === '') return task
  return roomTypeStrategies.find(item => item.id === value) ?? null
}

export const listRoomTypes = () => roomTypeStrategies.map(item => ({
  id: item.id,
  name: item.name,
  description: item.description,
  defaultVerify: item.defaultVerify,
  defaultSeats: item.defaultSeats,
  readOnly: item.readOnly === true,
}))
