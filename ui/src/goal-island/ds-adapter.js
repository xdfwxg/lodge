import { createElement as h, useEffect, useState } from 'react'
import { BotMark } from '../marks.js'
import { GoalIsland, GOAL_CSS, goalView } from './ds-goal.js'
import { ChevronDownIcon } from './ds-icons.js'
import { activeIndex, evidenceFor, rejectsFor, seatState, seatTask } from './model.js'

// DS-Bot's goal island wants goal/roster/roomWork; Lodge keeps room/stages/verdicts.
// This adapter is the only place that translates between the two shapes.
export const toDsGoal = room => {
  const stages = room.stages.map((stage, index) => {
    const seats = room.seatSpecs ?? []
    const assigned = (stage.tasks ?? []).map(task => {
      const seat = seats.find(item => item.id === task.owner) ?? { id: task.owner, name: task.title }
      return { botId: task.owner, status: task.status, task: seatTask(seat, stage) }
    })
    const tasks = assigned.length > 0
      ? assigned
      : seats.map(seat => ({
        botId: seat.id,
        status: seatState(room, stage, index, seat.id),
        task: seatTask(seat, stage),
      }))
    const evidence = evidenceFor(room, index)
    const reworks = rejectsFor(room, index)
    const last = evidence.at(-1)
    return {
      title: stage.title,
      acceptance: stage.acceptance ?? (stage.kind === 'decision' ? '你确认这一步' : undefined),
      status: stage.state === 'passed' ? 'passed' : stage.state === 'active' ? 'active' : 'pending',
      tasks,
      evidence: last === undefined
        ? undefined
        : last.meta?.kind === 'manual'
          ? '人工产物就绪'
          : `${last.meta?.command ?? '验收命令'} · exit ${last.meta?.exit ?? '—'}`,
      reworks: reworks.length,
      feedback: reworks.at(-1)?.text,
    }
  })
  const conclusion = [...(room.messages ?? [])].reverse().find(message => message.kind === 'chat_conclusion' || message.kind === 'conclusion')
  const acceptance = (room.brief?.done ?? []).map(item => (typeof item === 'string' ? item : item?.text ?? '')).filter(Boolean)
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
    acceptance: acceptance.length === 0 ? undefined : acceptance.join('\n'),
    constraints: room.brief?.constraints ?? [],
    summary: conclusion?.text,
    evidence: typeof room.delivery?.commit === 'string' ? `commit ${room.delivery.commit.slice(0, 8)}` : undefined,
    reason: room.state === 'stopped' ? '目标已停止' : undefined,
  }
}

export const toDsRoster = seats => ({
  byId: Object.fromEntries(seats.map(seat => [seat.id, seat])),
})

export const toDsRoom = room => ({
  id: room.id,
  admin: room.leadSeat ?? room.members?.[0],
  members: room.members ?? [],
})

export const toDsRoomWork = room => {
  const busy = Array.isArray(room.busySeats) && room.busySeats.length > 0
    ? room.busySeats
    : room.busySeat ? [room.busySeat] : []
  return busy.map(botId => ({ botId }))
}

const pill = ({ room, view, open, onToggle }) => h('button', {
  type: 'button',
  className: 'bt-pill',
  'aria-expanded': open || undefined,
  onClick: onToggle,
}, h('span', { className: 'bt-pill-swap' },
  h('span', { className: 'bt-pill-goal' },
    h('span', { className: 'bt-pill-ico' }, h(BotMark, { bot: (room.seatSpecs ?? []).find(seat => seat.id === room.leadSeat), size: 24 })),
    h('span', { className: 'bt-pill-title' }, room.name),
    view === null ? null : h('span', { className: 'bt-pill-count' }, `${view.number ?? 0}/${view.count}`)),
  h('span', { className: 'bt-pill-name' }, room.goal)),
h('span', { className: 'bt-pill-go' }, h(ChevronDownIcon)))

const PILL_CSS = `
.bt-island{--bt-glass-bg:var(--bt-card);--bt-glass-rim:var(--bt-line-2);--bt-glass-shadow:0 10px 30px rgb(0 0 0 / .10)}
.bt-pill{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;height:40px;padding:7.5px 13.5px 7.5px 7.5px;border-radius:999px;background:var(--bt-glass-bg);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);border:.5px solid var(--bt-glass-rim);box-shadow:var(--bt-glass-shadow);color:var(--bt-ink);font-family:inherit;font-size:14px;line-height:20px;cursor:pointer;max-width:70%;box-sizing:border-box;transition:background-color .12s ease,transform .16s ease}
.bt-pill:hover{background:color-mix(in srgb,var(--bt-main),#777 9%)}
.bt-pill:active{transform:scale(.965)}
.bt-pill-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.bt-pill-go{flex:none;display:inline-flex;align-items:center;justify-content:flex-end;width:0;margin-left:-8px;overflow:hidden;opacity:0;filter:blur(6px);transform:translateX(-6px);color:var(--bt-ink-2);transition:width .2s ease,margin-left .2s ease,transform .2s ease,opacity .18s ease,filter .18s ease}
.bt-pill:hover .bt-pill-go,.bt-pill:focus-visible .bt-pill-go,.bt-pill[aria-expanded=true] .bt-pill-go{width:18px;margin-left:0;opacity:1;filter:none;transform:none}
.bt-pill[aria-expanded=true] .bt-pill-go svg{transform:rotate(180deg)}
.bt-soft{height:36px;border-radius:999px;border:0;background:var(--bt-hover);color:var(--bt-ink);padding:0 16px;font-size:14px;cursor:pointer;flex:none;white-space:nowrap}
.bt-soft:hover{background:var(--bt-active)}
.bt-soft:disabled{opacity:.4;cursor:default}
.bt-soft-sm{height:28px;padding:0 12px;font-size:12px}
.bt-send{height:40px;min-width:40px;border-radius:999px;border:0;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);font-size:14px;padding:0 14px;cursor:pointer;flex:none;white-space:nowrap}
.bt-send:disabled{opacity:.35;cursor:default}
.bt-input{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--bt-line);border-radius:8px;padding:0 10px;background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:13px;outline:none}
.bt-input:focus{border-color:var(--bt-line-2)}
.bt-input-area{height:auto;min-height:96px;padding:8px 10px;line-height:18px;resize:vertical}
.bt-goal-danger{color:var(--bt-danger)}
.bt-goal-danger[data-armed]{background:color-mix(in srgb,var(--bt-danger) 10%,transparent)}
.crew-ds-goal{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:14px 32px 0}
.crew-ds-goal-tools{display:flex;align-items:center;gap:6px;padding-left:2px}
@keyframes bt-veil-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media (max-width:760px){.crew-ds-goal{padding:10px 14px 0}.bt-island{width:min(380px,calc(100% - 8px))}.bt-island[data-open]{width:calc(100% - 8px)}}
`

export function DsGoalHeader({ room, seats, store, actions = {} }) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [room.id])
  const goal = toDsGoal(room)
  const roster = toDsRoster(seats)
  const roomWork = toDsRoomWork(room)
  const view = goalView(goal, { roster, roomWork })
  const dsRoom = toDsRoom(room)
  const goalActions = {
    toggleGoal: () => setOpen(value => !value),
    closeGoal: () => setOpen(false),
    closeGoalCompose: () => {},
    goalControl: (roomId, goalId, action) => {
      if (action === 'pause') return store.pause()
      if (action === 'resume') return store.resume()
      if (action === 'stop') return store.stop()
      return null
    },
    stopRoomWork: () => store.stop(),
    goalDraft: async () => {},
    reportError: (error, area) => console.error(`goal ${area}`, error),
  }
  return h('div', { className: 'crew-ds-goal' },
    h(GoalIsland, {
      room: dsRoom,
      goal,
      view,
      open,
      composing: false,
      roomWork,
      roster,
      actions: goalActions,
      pill: pill({ room, view, open, onToggle: goalActions.toggleGoal }),
    }),
    h('div', { className: 'crew-ds-goal-tools' },
      h('button', { type: 'button', className: 'crew-ghost', onClick: actions.audit }, '审计详情'),
      h('button', { type: 'button', className: 'crew-ghost', onClick: actions.review }, '复盘'),
      actions.continue === undefined
        ? null
        : h('button', { type: 'button', className: 'crew-ghost', onClick: actions.continue }, room.state === 'complete' ? '基于此记录续做' : '分叉')),
    h('style', null, `${GOAL_CSS}\n${PILL_CSS}`))
}
