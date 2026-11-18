// The island is Lodge's own shape: rooms, stages and verdicts in; surface data out.
// This is the only place that translates room state for the island.

import { createElement as h, useState } from 'react'
import { GoalIsland, GOAL_CSS, goalView } from './surface.js'
import { TargetIcon } from '../icons.js'
import { useGoalSignal } from './use-goal-signal.js'

// 房型能力决定岛要不要画步骤；聊天室没有阶段，即使切过一次工作室也不显示残留阶段。
const stagesOf = room => room.modeCapabilities?.stages === false
  ? []
  : Array.isArray(room.stages) ? room.stages : []
const activeIndex = room => stagesOf(room).findIndex(stage => stage.state === 'active')

export const toIslandGoal = room => ({
  id: room.id,
  title: room.name,
  status: room.state === 'complete'
    ? 'complete'
    : room.state === 'paused' ? 'paused' : room.state === 'stopped' ? 'stopped' : 'active',
  idle: room.idle === true || room.needsYou?.kind === 'idle',
  current: activeIndex(room),
  stages: stagesOf(room).map(stage => ({
    title: stage.title,
    kind: stage.kind,
    status: stage.state === 'passed' ? 'passed' : stage.state === 'active' ? 'active' : 'pending',
  })),
  objective: room.brief?.objective || room.goal,
})

const toIslandRoom = room => ({
  id: room.id,
  needsYou: room.needsYou ?? null,
  attention: Array.isArray(room.attention) ? room.attention : [],
})

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
    view === null || (view.count ?? 0) === 0
      ? null
      : h('span', { className: 'bt-pill-count' }, `${view.number ?? 0}/${view.count}`)))
}

const PILL_CSS = `
.bt-pill{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;height:40px;padding:7.5px 13.5px 7.5px 7.5px;border-radius:999px;background:var(--bt-card);border:.5px solid var(--bt-line-2);box-shadow:var(--bt-elev-1);color:var(--bt-ink);font-family:inherit;font-size:var(--bt-text-label);line-height:20px;cursor:pointer;max-width:70%;box-sizing:border-box;transition:background-color .12s ease,transform .16s ease}
.bt-pill:hover{background:var(--bt-hover)}
.bt-pill:active{transform:scale(.965)}
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

// 默认收成小胶囊，悬停或键盘聚焦时放大，露出目标原句。
function DoneIsland({ goal, label }) {
  const [peek, setPeek] = useState(false)
  return h('div', {
    className: 'crew-island-done-wrap',
    'data-peek': peek ? 'true' : undefined,
    tabIndex: 0,
    'aria-label': `房间${label}`,
    onPointerEnter: event => { if (event.pointerType !== 'touch') setPeek(true) },
    onPointerLeave: () => setPeek(false),
    onFocus: event => { if (event.target.matches(':focus-visible')) setPeek(true) },
    onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) setPeek(false) },
  },
  h('div', { className: 'crew-island-done' },
    h('span', { className: 'crew-island-done-dot', 'aria-hidden': true }),
    h('span', { className: 'crew-island-done-copy' },
      h('span', { className: 'crew-island-done-kicker' }, goal.objective || goal.title),
      h('span', { className: 'crew-island-done-title' }, label))))
}

export function GoalIslandHeader({ room, goal: goalOverride = null, status = null, onOpenRoom }) {
  const activity = useGoalSignal(room)
  const open = activity.mode === 'open'
  const goal = goalOverride ?? toIslandGoal(room)
  const view = goalView(goal)
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
    // 收件箱里的一条：子房的事跳过去，本房的事滚到要你处理的位置。
    openItem: item => {
      if (typeof item?.roomId === 'string' && item.roomId !== room.id && typeof onOpenRoom === 'function') {
        onOpenRoom(item.roomId)
        return
      }
      goalActions.openSignal()
    },
  }
  const finished = goal.stages.length > 0 && goal.stages.every(stage => stage.status === 'passed')
  const doneLabel = room.modeCapabilities?.stages === false ? '已确认' : '已交付'
  return h('div', { className: 'crew-goal-island' },
    finished
      ? h(DoneIsland, { goal, label: doneLabel })
      : h(GoalIsland, {
        room: islandRoom,
        goal,
        view,
        mode: activity.mode,
        signal: activity.signal,
        actions: goalActions,
        pill: pill({ room, view, open, onToggle: goalActions.toggleGoal }),
      }),
    status,
    h('style', null, `${GOAL_CSS}\n${PILL_CSS}`))
}
