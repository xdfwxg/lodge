// 产品级房型清单：只放数据，不放实现。
// 服务端创建描述符与界面描述符都从这里取名称、描述、默认验收与能力，避免多处漂移。

export const ROOM_TYPE_MANIFEST = Object.freeze([
  Object.freeze({
    id: 'studio',
    name: '工作室',
    description: '目标、阶段、验收与交付；被 @ 的成员才唤醒',
    defaultVerify: 'test',
    readOnly: false,
    capabilities: Object.freeze({
      workCard: true,
      stages: true,
      gates: true,
      evidence: true,
      verdict: true,
      piExecution: true,
      customProfiles: true,
    }),
  }),
  Object.freeze({
    id: 'chat',
    name: '聊天室',
    description: '围绕一个话题讨论，随机唤醒发言，聊到上限后系统收结论，想继续可以接着聊',
    defaultVerify: 'manual',
    readOnly: true,
    capabilities: Object.freeze({
      workCard: false,
      stages: false,
      gates: false,
      evidence: false,
      verdict: false,
      piExecution: false,
      customProfiles: true,
    }),
  }),
])

export const roomTypeMeta = id => ROOM_TYPE_MANIFEST.find(item => item.id === id) ?? null
