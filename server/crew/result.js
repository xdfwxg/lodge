// 业务结果：crew 层只表达语义，不携带 HTTP 状态码。
export const ok = body => ({ ok: true, body })
export const created = body => ({ ok: true, created: true, body })
export const accepted = body => ({ ok: true, accepted: true, body })
export const fail = (reason, error) => ({ ok: false, reason, error })
