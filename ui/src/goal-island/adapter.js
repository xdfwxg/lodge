// The island is Lodge's own shape: rooms, stages and verdicts in; surface data out.
// This is the only place that translates room state for the island.

import { createElement as h } from 'react'
import { GoalIsland, GOAL_CSS, goalView } from './surface.js'
import { ChevronDownIcon } from './glyphs.js'
import { TargetIcon } from '../icons.js'
import { activeIndex, evidenceFor, rejectsFor, memberState, memberTask } from './model.js'
import { useGoalSignal } from './use-goal-signal.js'

export const toIslandGoal = room => {
  const stages = room.stages.map((stage, index) => {
    const members = room.members ?? []
    const assigned = (stage.tasks ?? []).map(task => {
      const member = members.find(item => item.id === task.owner) ?? { id: task.owner, name: task.title }
      return { memberId: task.owner, status: task.status, task: memberTask(member, stage) }
    })
    const tasks = assigned.length > 0
      ? assigned
      : members.map(member => ({
        memberId: member.id,
        status: memberState(room, stage, index, member.id),
        task: memberTask(member, stage),
      }))
    const evidence = evidenceFor(room, index)
    const reworks = rejectsFor(room, index)
    const last = evidence.at(-1)
    return {
      title: stage.title,
      kind: stage.kind,
      acceptance: stage.acceptance ?? (stage.kind === 'decision' ? '你定这一步' : undefined),
      status: stage.state === 'passed' ? 'passed' : stage.state === 'active' ? 'active' : 'pending',
      tasks,
      evidence: last === undefined
        ? undefined
        : last.meta?.kind === 'manual'
          ? '结果待确认'
          : `${last.meta?.exit === 0 ? '检查通过' : last.meta?.exit === null || last.meta?.exit === undefined ? '已经检查' : '检查没通过'}`,
      reworks: reworks.length,
      feedback: reworks.at(-1)?.text,
    }
  })
  const conclusion = [...(room.messages ?? [])].reverse().find(message => message.kind === 'chat_conclusion' || message.kind === 'conclusion')
  const commandEvidence = (room.messages ?? []).filter(message => (
    message.kind === 'evidence' && message.meta?.kind === 'command'
  ))
  const checks = stages.map((stage, index) => {
    if (stage.kind !== 'deliverable' || typeof stage.acceptance !== 'string' || stage.acceptance.trim() === '') return null
    const last = commandEvidence.filter(message => (message.meta?.stage ?? 0) === index).at(-1)
    return {
      stage: index,
      title: stage.title,
      command: stage.acceptance.trim(),
      exit: last?.meta?.exit ?? null,
      ran: last !== undefined,
      passed: last?.meta?.exit === 0,
    }
  }).filter(Boolean)
  const acceptance = checks.map(check => `第 ${check.stage + 1} 步：${check.command}`)
  const plannedDone = (room.plan?.done ?? []).map(item => (typeof item === 'string' ? item : item?.text ?? '')).filter(Boolean)
  const delivered = (room.delivery?.changedFiles ?? room.delivery?.artifacts?.map(artifact => artifact.path) ?? []).filter(Boolean)
  const deliverables = delivered.length > 0
    ? delivered
    : plannedDone.length > 0
      ? plannedDone
      : (room.stages ?? []).filter(stage => stage.kind === 'deliverable').map(stage => stage.title)
  const constraints = (room.brief?.constraints ?? [])
    .filter(item => typeof item === 'string' && !/^验收命令\s*[:：]/.test(item.trim()))
  return {
    id: room.id,
    title: room.name,
    status: room.state === 'complete'
      ? 'complete'
      : room.state === 'paused' ? 'paused' : room.state === 'stopped' ? 'stopped' : 'active',
    idle: room.idle === true || room.needsYou?.kind === 'idle',
    current: activeIndex(room),
    stages,
    objective: room.brief?.objective || room.goal,
    acceptance: acceptance.length === 0 ? '由你看过结果后确认' : acceptance.join('\n'),
    deliverables,
    checks,
    constraints,
    summary: conclusion?.text,
    evidence: typeof room.delivery?.commit === 'string' ? '已保存版本' : undefined,
    reason: room.state === 'stopped' ? '目标已停止' : undefined,
    evidenceCount: (room.messages ?? []).filter(message => message.kind === 'evidence').length,
  }
}

export const toIslandRoster = members => ({
  byId: Object.fromEntries(members.map(member => [member.id, member])),
})

const toIslandRoom = room => ({
  id: room.id,
  admin: room.leadMemberId ?? room.members?.[0],
  members: room.members ?? [],
  needsYou: room.needsYou ?? null,
  attention: Array.isArray(room.attention) ? room.attention : [],
})

export const toIslandRoomWork = room => (room.busyMembers ?? []).map(memberId => ({ memberId }))

const pill = ({ room, view, open, onToggle }) => {
  const title = view?.title || room.name || room.goal
  return h('button', {
    type: 'button',
    className: 'bt-pill',
    'aria-expanded': open || undefined,
    onClick: onToggle,
  },
  h('span', { className: 'bt-pill-goal' },
    h('span', { className: 'bt-pill-ico' }, h(TargetIcon)),
    h('span', { className: 'bt-pill-title', title }, title),
    view === null ? null : h('span', { className: 'bt-pill-count' }, `${view.number ?? 0}/${view.count}`)),
  h('span', { className: 'bt-pill-go' }, h(ChevronDownIcon)))
}

const PILL_CSS = `
.bt-pill{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;height:40px;padding:7.5px 13.5px 7.5px 7.5px;border-radius:999px;background:var(--bt-card);border:.5px solid var(--bt-line-2);box-shadow:var(--bt-elev-1);color:var(--bt-ink);font-family:inherit;font-size:var(--bt-text-label);line-height:20px;cursor:pointer;max-width:70%;box-sizing:border-box;transition:background-color .12s ease,transform .16s ease}
.bt-pill:hover{background:var(--bt-hover)}
.bt-pill:active{transform:scale(.965)}
.bt-pill-go{flex:none;display:inline-flex;align-items:center;justify-content:flex-end;width:18px;overflow:hidden;color:var(--bt-ink-2)}
.bt-pill[aria-expanded=true] .bt-pill-go svg{transform:rotate(180deg)}
.bt-soft{height:36px;border-radius:999px;border:0;background:var(--bt-hover);color:var(--bt-ink);padding:0 16px;font-size:var(--bt-text-label);cursor:pointer;flex:none;white-space:nowrap}
.bt-soft:hover{background:var(--bt-active)}
.bt-soft:disabled{opacity:.4;cursor:default}
.bt-soft-sm{height:28px;padding:0 12px;font-size:var(--bt-text-helper)}
.bt-send{height:40px;min-width:40px;border-radius:999px;border:0;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);font-size:var(--bt-text-label);padding:0 14px;cursor:pointer;flex:none;white-space:nowrap}
.bt-send:disabled{opacity:.35;cursor:default}
.bt-input{width:100%;box-sizing:border-box;height:var(--bt-control-h);border:1px solid var(--bt-line-2);border-radius:8px;padding:0 10px;background:var(--bt-input-bg);color:var(--bt-ink);font:inherit;font-size:var(--bt-text-label);outline:none}
.bt-input:hover{border-color:var(--bt-line-control)}
.bt-input:focus{border-color:var(--bt-accent);box-shadow:0 0 0 3px var(--bt-accent-wash);outline:none}
.bt-input:disabled{opacity:.55;cursor:not-allowed}
.bt-input-area{height:auto;min-height:96px;padding:8px 10px;line-height:18px;resize:vertical}
.crew-goal-island{position:absolute;top:12px;left:32px;right:32px;z-index:20;display:flex;flex-direction:column;align-items:center;gap:8px;padding:0;pointer-events:none}
.crew-goal-island>*{pointer-events:auto}
.crew-goal-island .bt-island{align-self:center}
@keyframes bt-veil-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media (max-width:760px){.crew-goal-island{top:10px;left:14px;right:14px;padding:0}.bt-island{width:min(380px,calc(100% - 8px))}.bt-island[data-mode=peek],.bt-island[data-mode=decision],.bt-island[data-mode=open]{width:calc(100% - 8px)}}
`

export function GoalIslandHeader({ room, members, status = null, onAdvance, onOpenRoom }) {
  const activity = useGoalSignal(room)
  const open = activity.mode === 'open'
  const goal = toIslandGoal(room)
  const roster = toIslandRoster(members)
  const roomWork = toIslandRoomWork(room)
  const view = goalView(goal, { roster })
  const islandRoom = toIslandRoom(room)
  const goalActions = {
    toggleGoal: () => (open ? activity.onClose() : activity.onOpen()),
    closeGoal: activity.onClose,
    openSignal: () => {
      const target = typeof document === 'undefined'
        ? null
        : document.querySelector('[data-room-decision]')
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: 'center' })
        target.focus({ preventScroll: true })
        return
      }
      activity.onOpen()
    },
    dismissSignal: activity.onDismiss,
    pauseSignal: activity.onPause,
    resumeSignal: activity.onResume,
    advance: onAdvance,
    // 收件箱里的一条：子房的事跳过去，本房的事滚到要你处理的位置。
    openItem: item => {
      if (typeof item?.roomId === 'string' && item.roomId !== room.id && typeof onOpenRoom === 'function') {
        onOpenRoom(item.roomId)
        return
      }
      goalActions.openSignal()
    },
  }
  return h('div', { className: 'crew-goal-island' },
    h(GoalIsland, {
      room: islandRoom,
      goal,
      view,
      mode: activity.mode,
      signal: activity.signal,
      roomWork,
      roster,
      actions: goalActions,
      pill: pill({ room, view, open, onToggle: goalActions.toggleGoal }),
    }),
    status,
    h('style', null, `${GOAL_CSS}\n${PILL_CSS}`))
}
