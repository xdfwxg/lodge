// 三态结果：
// - ok / created / accepted：成功；
// - fail：可预期的业务拒绝，由组合根映射 4xx；
// - 其他异常：系统/基座/IO 错误，直接抛到组合根（500），不要用 fail 包装。
export const ok = body => ({ ok: true, body })
export const created = body => ({ ok: true, created: true, body })
export const accepted = body => ({ ok: true, accepted: true, body })
export const fail = (reason, error) => ({ ok: false, reason, error })

export class BusinessError extends Error {
  constructor(reason, message) {
    super(message)
    this.name = 'BusinessError'
    this.reason = reason
  }
}

export const reject = (reason, message) => {
  throw new BusinessError(reason, message)
}
