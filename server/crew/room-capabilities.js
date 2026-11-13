// 两套房间引擎的能力矩阵：代码只读这张表，不在各处散落房型 if。
export const ROOM_CAPABILITIES = Object.freeze({
  chat: Object.freeze({
    workCard: false,
    stages: false,
    gates: false,
    closure: false,
    trust: false,
    evidence: false,
    verdict: false,
    piExecution: false,
    jev: 'optional',
    customProfiles: true,
  }),
  studio: Object.freeze({
    workCard: true,
    stages: true,
    gates: true,
    closure: true,
    trust: true,
    evidence: true,
    verdict: true,
    piExecution: true,
    jev: true,
    customProfiles: true,
  }),
})

export const capabilitiesFor = roomType => ROOM_CAPABILITIES[roomType] ?? null
