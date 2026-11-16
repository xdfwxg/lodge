// 默认三人组的名字与角色：建房页的成员摘要和服务端默认花名册共用这一份。
export const DEFAULT_STUDIO_ROSTER = Object.freeze([
  Object.freeze({ role: 'lead', name: '规划师' }),
  Object.freeze({ role: 'worker', name: '执行官' }),
  Object.freeze({ role: 'verifier', name: '验收员' }),
])
