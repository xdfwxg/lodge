import { assessTurn } from '../../../turn-assessment.js'

// 一回合的诊断只属于这一回合：记录事实、算评估、落盘并更新阶段摘要。
// 采集流程只决定“结果是什么”，不在这里拼字段。
export const createTurnDiagnostics = ({ store, roomId, writeDiagnostic }) => ({
  room,
  stageIndex,
  memberId,
  role,
  turn,
  outcome,
  extra = {},
}) => {
  if (typeof writeDiagnostic !== 'function' || room === null || room === undefined) return
  const turnId = turn?.turnId
  try {
    const diagnostic = {
      version: 2,
      roomId,
      roomName: room.name,
      stage: stageIndex,
      stageTitle: room.stages?.[stageIndex]?.title ?? '',
      memberId,
      role,
      turnId,
      at: turn?.at ?? null,
      durationMs: turn?.durationMs ?? null,
      toolCalls: turn?.toolCalls ?? 0,
      tools: Array.isArray(turn?.tools) ? turn.tools : [],
      usage: turn?.usage ?? null,
      hookCoverage: turn?.hookCoverage ?? null,
      outcome,
      assessment: assessTurn({ outcome, turn, extra }),
      ...extra,
    }
    void Promise.resolve(writeDiagnostic(room, turnId, diagnostic)).catch(() => {})
    store.updateRound(roomId, current => {
      current.stageDiagnostics = {
        ...(current.stageDiagnostics ?? {}),
        [stageIndex]: {
          at: diagnostic.at ?? Date.now(),
          memberId,
          outcome,
          turnId,
          assessment: diagnostic.assessment,
        },
      }
      return { events: [] }
    })
  } catch {}
}
