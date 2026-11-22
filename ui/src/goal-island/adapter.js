// The island is Lodge's own shape: rooms, stages and verdicts in; surface data out.
// This is the only place that translates room state for the island.

import { createElement as h } from 'react'
import { GoalIsland, GOAL_CSS, goalView } from './surface.js'
import { Lingchong, LINGCHONG_CSS } from './lingchong.js'
import { useHoverPeek } from './use-hover-peek.js'
import { TargetIcon } from '../icons.js'
import { useGoalSignal } from './use-goal-signal.js'
import { islandStatusOf, islandWorking } from './status.js'
import { needsAction } from '../needs.js'

import { stripAttachmentTags } from '../../../shared/attachments.js'
import { chatStartedOf } from '../../../shared/room-status.js'

// 房型能力决定岛要不要画步骤；聊天室没有阶段，即使切过一次工作室也不显示残留阶段。
const stagesOf = room => room.modeCapabilities?.stages === false
  ? []
  : Array.isArray(room.stages) ? room.stages : []
const activeIndex = room => stagesOf(room).findIndex(stage => stage.state === 'active')

// 旧轮可能存过被截断的附件标记（没有结尾的 />），显示时连半截一起拿掉。
const cleanTitle = value => stripAttachmentTags(value)
  .replace(/<attached-(?:image|file)[\s\S]*$/i, '')
  .trim()

// 岛的当前状态只从状态图读；完成过一轮不等于现在已交付。
const kindOfRoom = room => room.modeCapabilities?.stages === false ? 'chat' : 'studio'
const deliveredNow = room => islandStatusOf(room, kindOfRoom(room)).key === 'done'

export const toIslandGoal = room => {
  const islandStatus = islandStatusOf(room, kindOfRoom(room))
  const done = deliveredNow(room)
  return {
    id: room.id,
    title: cleanTitle(room.name),
    status: done
      ? 'complete'
      : islandStatus.key === 'paused' ? 'paused'
        : islandStatus.key === 'stopped' || islandStatus.key === 'archived' ? 'stopped' : 'active',
    idle: room.idle === true || room.needsYou?.kind === 'idle',
    current: activeIndex(room),
    stages: stagesOf(room).map(stage => ({
      title: cleanTitle(stage.title),
      kind: stage.kind,
      status: stage.state === 'passed' ? 'passed' : stage.state === 'active' ? 'active' : 'pending',
    })),
    objective: cleanTitle(room.brief?.objective || room.goal),
    barLabel: islandStatus.barLabel ?? undefined,
    tone: islandStatus.tone,
    stageLabel: islandStatus.stageLabel,
  }
}

const toIslandRoom = room => ({
  id: room.id,
  kind: room.modeCapabilities?.stages === false ? 'chat' : 'studio',
  lodge: room.lodge === true,
  needsYou: needsAction(room),
  attention: Array.isArray(room.attention)
    ? room.attention.filter(item => item?.actionable !== false)
    : [],
  // 岛只拿裁剪后的房间；聊天有没有开始由共享读模型算，别在这里另拼一套。
  chatStarted: chatStartedOf(room),
  // 真正有回合在跑时才“灵动”地展开；回合结束回到最小，不常驻一条状态。
  working: islandWorking(room),
})

const pill = ({ room, view, open, onToggle }) => {
  const title = view?.title || room.name || stripAttachmentTags(room.goal)
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
.crew-goal-island{position:absolute;top:0;left:0;right:0;z-index:20;display:flex;flex-direction:column;align-items:center;gap:8px;padding:36px 32px 0;pointer-events:none}
.crew-goal-island>*{pointer-events:auto}
.crew-goal-island .bt-island{align-self:center}
@keyframes bt-veil-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media (max-width:760px){.crew-goal-island{top:0;left:0;right:0;padding:22px 14px 0}.bt-island{width:min(380px,calc(100% - 8px))}.bt-island[data-mode=peek],.bt-island[data-mode=decision],.bt-island[data-mode=open]{width:calc(100% - 8px)}.lingchong{width:88px;height:45px}}
`

// 默认收成小胶囊，悬停或键盘聚焦时放大，露出目标原句。
function DoneIsland({ goal, label, lingchongMode = 'studio' }) {
  const { peeking: peek, onPointerEnter, onPointerLeave, onFocus, onBlur } = useHoverPeek()
  return h('div', {
    className: 'crew-island-done-wrap',
    'data-peek': peek ? 'true' : undefined,
    tabIndex: 0,
    'aria-label': `房间${label}`,
    onPointerEnter,
    onPointerLeave,
    onFocus,
    onBlur,
  },
  h(Lingchong, { state: 'done', mode: lingchongMode }),
  h('div', { className: 'crew-island-done' },
    h('span', { className: 'crew-island-done-dot', 'aria-hidden': true }),
    h('span', { className: 'crew-island-done-copy' },
      h('span', { className: 'crew-island-done-kicker' }, goal.objective || goal.title),
      h('span', { className: 'crew-island-done-title' }, label))))
}

export function GoalIslandHeader({ room, goal: goalOverride = null, status = null, onOpenRoom, onSignalAction = null }) {
  const activity = useGoalSignal(room)
  const open = activity.mode === 'open'
  const goal = goalOverride ?? toIslandGoal(room)
  const view = goalView(goal)
  const islandRoom = toIslandRoom(room)
  const goalActions = {
    toggleGoal: () => (open ? activity.onClose() : activity.onOpen()),
    closeGoal: activity.onClose,
    openSignal: () => {
      // 规划师只问一个问题时没有卡片，落点是房间输入框：直接在下面回答。
      const composer = typeof document === 'undefined' || activity.signal?.kind !== 'question'
        ? null
        : document.querySelector('[aria-label="房间消息"]')
      if (composer instanceof HTMLElement) {
        composer.scrollIntoView({ block: 'center' })
        composer.focus({ preventScroll: true })
        return
      }
      const target = typeof document === 'undefined'
        ? null
        : document.querySelector('[data-room-decision]')
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: 'center' })
        const action = target.querySelector('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')
        ;(action instanceof HTMLElement ? action : target).focus({ preventScroll: true })
        return
      }
      activity.onOpen()
    },
    actSignal: action => {
      if (typeof onSignalAction === 'function' && onSignalAction(activity.signal, action) !== false) return
      goalActions.openSignal()
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
      const target = typeof document === 'undefined' ? null : document.querySelector('[data-room-decision]')
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: 'center' })
        target.querySelector('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')
          ?.focus({ preventScroll: true })
        return
      }
      const result = typeof document === 'undefined' ? null : document.querySelector(
        '.crew-msg-conclusion, .crew-verdict-card, .crew-delivery-stage, .studio-delivery',
      )
      if (result instanceof HTMLElement) {
        result.scrollIntoView({ block: 'center' })
        return
      }
      activity.onClose()
    },
  }
  const statusKey = islandStatusOf(room, kindOfRoom(room)).key
  const finished = statusKey === 'done'
  const doneLabel = '已交付'
  const lingchongState = finished ? 'done'
    : statusKey === 'waiting' ? 'needs'
      : statusKey === 'running' && islandWorking(room) ? 'busy' : 'rest'
  return h('div', { className: 'crew-goal-island' },
    finished
      ? h(DoneIsland, { goal, label: doneLabel, lingchongMode: islandRoom.kind })
      : h(GoalIsland, {
        room: islandRoom,
        goal,
        view,
        mode: activity.mode,
        signal: activity.signal,
        actions: goalActions,
        lingchongState,
        pill: pill({ room, view, open, onToggle: goalActions.toggleGoal }),
      }),
    status,
    h('style', null, `${GOAL_CSS}\n${PILL_CSS}\n${LINGCHONG_CSS}`))
}
