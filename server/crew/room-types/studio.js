import { roleKindOf } from '../seats.js'
import * as task from './task.js'

export const id = 'studio'
export const name = '工作室'
export const description = '目标、阶段、验收与交付；被 @ 的席位才唤醒'
export const defaultVerify = task.defaultVerify
export const defaultSeats = task.defaultSeats
export const autoStart = task.autoStart
export const singleDirectory = true
export const normalize = task.normalize
export const buildStages = task.buildStages

// 工作室只有三类本质角色；其他岗位名称必须映射到这三类之一，不能再造 observer 之类第四类。
export const validateRoster = (roster, { verify } = {}) => {
  const kindOf = seat => seat.roleKind ?? roleKindOf(seat.role)
  const invalid = roster.filter(seat => !['planner', 'executor', 'verifier'].includes(kindOf(seat)))
  if (invalid.length > 0) {
    throw new Error(`工作室席位只能从规划师/执行官/验收员派生：${invalid.map(seat => seat.name ?? seat.id).join('、')}`)
  }
  if (!roster.some(seat => kindOf(seat) === 'planner')) throw new Error('工作室需要规划师席位')
  if (!roster.some(seat => kindOf(seat) === 'verifier')) throw new Error('工作室需要独立验收席位')
}
