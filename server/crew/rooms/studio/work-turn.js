import { verdictPassed } from '../../../../shared/judgment.js'

const clip = (text, limit) => {
  const value = String(text ?? '').trim()
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

// 工作拍是接力棒的结果：只装下一席需要的事实，不复制整场对话。
export const buildWorkTurn = ({
  room,
  stage,
  index,
  from,
  to,
  reason,
  acceptance,
  evidence,
  verdict,
  candidate,
}) => ({
  stage: index,
  title: stage?.title ?? '',
  kind: stage?.kind ?? '',
  acceptance: typeof acceptance === 'string' ? acceptance : stage?.acceptance ?? '',
  from,
  to,
  reason,
  goal: room?.goal ?? '',
  done: Array.isArray(room?.plan?.done) ? room.plan.done.slice(0, 6) : [],
  constraints: Array.isArray(room?.constraints) ? room.constraints.slice(0, 6) : [],
  evidence: evidence === undefined || evidence === null
    ? null
    : {
        id: evidence.id,
        command: evidence.meta?.command ?? '',
        exit: evidence.meta?.exit ?? null,
        changedFiles: Array.isArray(evidence.meta?.changedFiles) ? evidence.meta.changedFiles.slice(0, 20) : [],
        text: clip(evidence.text, 800),
      },
  verdict: verdict === undefined || verdict === null
    ? null
    : { pass: verdictPassed(verdict), text: clip(verdict.text, 500) },
  candidate: typeof candidate === 'string' && candidate !== '' ? candidate : null,
})
