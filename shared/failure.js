// 引擎失败的三种状态和文案只在这里定义，服务端和界面都从这里取。
export const FAILURE_LABELS = Object.freeze({
  quota: '额度用完',
  auth: '登录失效',
  rate_limit: '被限流',
  engine: '没回应',
})

export const failureLabel = (kind, name) => ({
  quota: `${name}的模型额度用完了`,
  auth: `${name}的登录失效了`,
  rate_limit: `${name}被模型服务限流了`,
  engine: `${name}没能回应`,
}[kind] ?? `${name}没能回应`)

export const failureNextStep = kind => (
  kind === 'quota' ? '充值或给这位成员换个模型后，点“继续”。' : '处理完成后点“继续”。'
)

export const failureCopy = (kind, name) => ({
  quota: `${failureLabel(kind, name)}，房间已暂停。充值或给这位成员换个模型后，点“继续”。`,
  auth: `${failureLabel(kind, name)}，房间已暂停。重新登录或换个模型服务后，点“继续”。`,
  rate_limit: `${failureLabel(kind, name)}，房间已暂停。稍后点“继续”，或给这位成员换个模型。`,
  engine: `${failureLabel(kind, name)}，房间已暂停。检查模型服务设置后，点“继续”。`,
}[kind] ?? `${failureLabel(kind, name)}，房间已暂停。检查模型服务设置后，点“继续”。`)
