// Vendored from Fei2411/DS-Bot, ds-bot/src/client/goal.js (Apache-2.0).
// Kept close to the upstream component; only imports, avatars and i18n are adapted to Lodge.

import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { BotAvatar } from '../marks.js'
import { TargetIcon } from '../icons.js'
import { CheckIcon, ChevronDownIcon } from './ds-icons.js'
import { useEscape } from './ds-overlay.js'
import { SPRING_SHAPE, spring, useMorph } from './ds-motion.js'
import { t } from './ds-i18n.js'

// -------------------------------------------------------------------------
// Group goal: the header island is the goal's status screen. One surface wraps
// the pill (title and progress on the top row) with a pod hanging under it —
// a status bar while closed, the full plan while open, a draft form while the
// user writes the brief. `goalView` derives everything shown as plain data.

const REPORTED = new Set(['reported', 'done'])
const RUNNING = new Set(['active', 'paused'])

// The admin runs a goal, so a goal needs one among the members.
export const hasGoalAdmin = (room, roster) => room !== undefined
  && room.members?.includes(room.admin) === true && roster.byId?.[room.admin] !== undefined

// A draft is allowed while no goal is in flight; a finished one is archived away.
export const canSetGoal = (room, roster) => hasGoalAdmin(room, roster)
  && room.goal?.status !== 'active' && room.goal?.status !== 'paused'

// What the island and panel draw, as plain data: goal + live room work in, the
// capsule number, the bar's label, the stage segments and the panel's stage
// rows out.
export function goalView(goal, { roster = {} } = {}) {
  if (goal === null || goal === undefined) return null
  const stages = goal.stages ?? []
  const count = stages.length
  const at = goal.current
  const current = RUNNING.has(goal.status) ? stages[at] : undefined
  const checking = current !== undefined && (current.tasks ?? []).every(task => REPORTED.has(task.status))
  // The capsule counts the stage the goal is at, not the stages done.
  const number = goal.status === 'drafting' ? undefined
    : goal.status === 'stopped' ? stages.filter(stage => stage.status === 'passed').length
      : current !== undefined ? at + 1
        : count
  const barLabel =
    goal.status === 'drafting' ? t('Aligning the goal with you')
      : goal.status === 'stopped' ? t('Stopped')
        : goal.status === 'complete' ? ''
          : goal.status === 'paused' ? (current ? t('Paused · {title}', { title: current.title }) : t('Paused'))
            : goal.idle === true ? (current ? t('Waiting for you · {title}', { title: current.title }) : t('Waiting for you'))
              : current === undefined ? t('Final check')
                : checking ? t('Checking · {title}', { title: current.title })
                  : current.title
  const segments = stages.map((stage, i) => (stage.status === 'passed' ? 'done'
    : i === at && (goal.status === 'paused' || goal.idle === true) ? 'paused'
      : i === at && goal.status === 'active' ? (checking ? 'checking' : 'current')
        : 'todo'))
  const stageViews = stages.map((stage, i) => ({
    n: i + 1,
    title: stage.title,
    acceptance: stage.acceptance,
    status: stage.status,
    kind: stage.status === 'passed' ? 'passed'
      : i === at && RUNNING.has(goal.status) ? 'current'
        : 'upcoming',
    tasks: (stage.tasks ?? []).map(task => ({ bot: roster.byId?.[task.botId], task: task.task, status: task.status })),
    evidence: stage.evidence,
    reworks: stage.reworks ?? 0,
    feedback: stage.feedback,
  }))
  return {
    status: goal.status, idle: goal.idle === true, title: goal.title ?? '',
    number, count, segments, barLabel, stages: stageViews,
  }
}

// Escape and outside clicks close the open panel; mounted only while it is open
// so the shared Escape stack sees it as the newest layer.
function GoalOutside({ island, close }) {
  useEscape(close)
  useEffect(() => {
    const onDown = (event) => { if (island.current && !island.current.contains(event.target)) close() }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [close])
  return null
}

// One task in the selected stage: avatar carries the state (pulse while it
// works, a small check once reported or done, dimmed before it starts).
function TaskRow({ task, working }) {
  const live = working.has(task.bot?.id) || task.status === 'working'
  const returned = REPORTED.has(task.status)
  return h('div', { className: 'bt-goal-task', 'data-task': task.status === 'pending' ? 'pending' : undefined },
    h('span', { className: 'bt-goal-tav' },
      task.bot ? h(BotAvatar, { bot: task.bot, size: 20, live }) : null,
      returned ? h('span', { className: 'bt-goal-tdone', 'aria-hidden': true }, h(CheckIcon)) : null),
    h('span', { className: 'bt-goal-ttext' },
      h('span', { className: 'bt-goal-tname' }, task.bot?.name ?? t('a Bot')),
      ' ', task.task))
}


// Closed: one 40px capsule with the goal, progress, status and stage track.
// The signal row below it is the only thing that grows the island on its own.
function GoalClosed({ view, room, actions }) {
  const title = view?.title || room.name || '目标'
  const status = room.needsYou?.label ?? view?.barLabel ?? '还没有目标'
  const tone = view?.status === 'complete' ? 'done'
    : view?.status === 'stopped' ? 'stopped'
      : view?.status === 'paused' || view?.idle === true || room.needsYou ? 'waiting'
        : view?.status === 'drafting' ? 'drafting' : 'active'
  return h('button', {
    type: 'button',
    className: 'bt-goal-closed',
    'aria-expanded': false,
    onClick: () => actions.toggleGoal(room.id),
  },
  h('span', { className: 'bt-goal-closed-main' },
    h('span', { className: 'bt-goal-closed-ico', 'aria-hidden': true }, h(TargetIcon)),
    h('span', { className: 'bt-goal-closed-title', title }, title),
    status === ''
      ? null
      : h('span', { className: 'bt-goal-closed-sub' },
        h('span', {
          className: 'bt-goal-closed-dot',
          'data-tone': tone,
          'data-live': (room.busyMembers ?? []).length > 0 ? 'true' : undefined,
          'aria-hidden': true,
        }),
        h('span', { className: 'bt-goal-closed-label' }, status)),
    h('span', { className: 'bt-goal-chev', 'aria-hidden': true }, h(ChevronDownIcon))),
  view === null
    ? null
    : h('span', { className: 'bt-goal-closed-segs', 'aria-hidden': true },
      view.segments.map((seg, i) => h('i', { key: i, 'data-seg': seg }))))
}

// A single line under the capsule: one thing happened, one way to look at it.
// Decisions keep the line until they are handled; milestones expire.
function GoalSignal({ signal, mode, actions }) {
  const inside = event => event.currentTarget.contains(event.relatedTarget)
  return h('div', {
    className: 'bt-goal-signal',
    'data-tone': signal.tone,
    'data-kind': signal.kind,
    'data-signal-key': signal.key,
    onPointerEnter: actions.pauseSignal,
    onPointerLeave: actions.resumeSignal,
    onFocus: event => { if (!inside(event)) actions.pauseSignal() },
    onBlur: event => { if (!inside(event)) actions.resumeSignal() },
  },
  h('button', {
    type: 'button',
    className: 'bt-goal-signal-main',
    title: signal.detail,
    onClick: actions.openSignal,
  },
  h('span', { className: 'bt-goal-signal-dot', 'aria-hidden': true }),
  h('span', { className: 'bt-goal-signal-text' }, signal.title),
  h('span', { className: 'bt-goal-signal-go' }, signal.kind === 'decision' ? '去处理' : '查看')),
  mode === 'decision'
    ? h('button', {
      type: 'button',
      className: 'bt-goal-signal-close',
      'aria-label': '收起这条提醒',
      onClick: event => {
        const capsule = event.currentTarget.closest('.bt-island')?.querySelector('.bt-goal-closed')
        actions.dismissSignal()
        requestAnimationFrame(() => capsule?.focus({ preventScroll: true }))
      },
    }, '×')
    : null,
  signal.kind === 'milestone'
    ? h('span', { className: 'visually-hidden', role: 'status', 'aria-live': 'polite' }, signal.title)
    : null)
}

// The open pod focuses one stage: a stepper across the top, the selected
// stage's checks and tasks under it, and a bottom row with the rest.
function GoalPanel({ goal, view, room, roster, actions, working }) {
  const at = RUNNING.has(view.status) && goal.current < view.stages.length ? goal.current : -1
  const [selected, setSelected] = useState(at)
  const [checks, setChecks] = useState(false)
  // The selected stage follows the goal's current one as stages pass.
  useEffect(() => setSelected(RUNNING.has(view.status) && goal.current < view.stages.length ? goal.current : -1), [view.status, goal.current])
  // Nodes too narrow for their number (14px, or 17px for two digits) drop it so the stepper still fits.
  const stepper = useRef(null)
  useEffect(() => {
    const box = stepper.current
    if (box === null || typeof ResizeObserver !== 'function') return undefined
    const min = view.stages.length >= 10 ? 17 : 14
    const measure = () => box.querySelectorAll('.bt-goal-step').forEach(node => node.classList.toggle('bt-goal-mini', node.clientWidth < min))
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    measure()
    return () => observer.disconnect()
  }, [view.stages.length])
  const stage = selected >= 0 ? view.stages[selected] : undefined
  const sec = (key, label, ...body) => h('div', { key, className: 'bt-goal-sec' },
    h('div', { className: 'bt-goal-sub' }, label), ...body.map((line, i) => h('div', { key: i, className: 'bt-goal-text' }, line)))
  const hasChecks = goal.objective !== undefined || goal.checks?.length > 0 || goal.constraints?.length > 0 || goal.deliverables?.length > 0
  const admin = roster.byId?.[room.admin]?.name ?? t('a Bot')
  const evidenceCount = goal.evidenceCount ?? view.stages.filter(stageView => stageView.evidence !== undefined).length
  const ruleCount = goal.constraints?.length ?? 0
  const meta = [
    evidenceCount > 0 ? `${evidenceCount} 条结果` : '',
    ruleCount > 0 ? `${ruleCount} 条约定` : '',
  ].filter(Boolean).join(' · ')
  return h('div', { className: 'bt-goal-panel', role: 'region', 'aria-label': view.title },
    h('div', { className: 'bt-goal-body' },
    view.status === 'drafting' ? null : h('div', { ref: stepper, className: 'bt-goal-steps', role: 'group', 'aria-label': t('Stages') },
      view.stages.map((stageView, i) => h('button', {
        key: stageView.n, type: 'button',
        className: 'bt-goal-step', 'data-step': stageView.kind === 'current' && (view.status === 'paused' || view.idle === true) ? 'waiting' : stageView.kind,
        'data-sel': i === selected || undefined,
        title: t('Stage {n}: {title}', { n: stageView.n, title: stageView.title }),
        'aria-label': t('Stage {n}: {title}', { n: stageView.n, title: stageView.title }),
        'aria-current': i === at ? 'step' : undefined,
        onClick: () => setSelected(i),
      }, h('span', { className: 'bt-goal-node' }, stageView.status === 'passed' ? h(CheckIcon) : stageView.n)))),
    room.needsYou?.label ? h('div', { className: 'bt-goal-warn' }, room.needsYou.label) : null,
    meta === '' ? null : h('div', { className: 'bt-goal-meta' }, meta),
    h('div', { key: `s${selected}`, className: 'bt-goal-bstage' },
      view.status === 'drafting' ? (goal.brief ? h('div', { className: 'bt-goal-btext' }, goal.brief) : null)
        : stage === undefined
          ? h(Fragment, null,
            goal.summary ? h('div', { className: 'bt-goal-btext' }, goal.summary) : null,
            goal.evidence ? h('div', { className: 'bt-goal-evi' }, goal.evidence) : null,
            view.status === 'stopped' && goal.reason ? h('div', { className: 'bt-goal-evi' }, goal.reason) : null)
          : h(Fragment, null,
            h('div', { className: 'bt-goal-bline' },
              h('span', { className: 'bt-goal-btitle' }, stage.title),
              selected !== at && at >= 0 ? h('button', { type: 'button', className: 'bt-goal-back', onClick: () => setSelected(at) }, t('Back to current stage')) : null),
            stage.acceptance ? h('div', { className: 'bt-goal-line' }, t('Done when: {text}', { text: stage.acceptance })) : null,
            selected === at && stage.reworks > 0 && stage.feedback
              ? h('div', { className: 'bt-goal-rw' }, stage.reworks > 1
                ? t('Sent back {n} times by {admin}. Last time: {feedback}', { n: stage.reworks, admin, feedback: stage.feedback })
                : t('Sent back by {admin}: {feedback}', { admin, feedback: stage.feedback })) : null,
            stage.evidence !== undefined && stage.status === 'passed' ? h('div', { className: 'bt-goal-evi' }, t('Evidence: {text}', { text: stage.evidence })) : null,
            stage.tasks.length > 0 ? h('div', { className: 'bt-goal-tasks' }, stage.tasks.map((task, i) => h(TaskRow, { key: i, task, working }))) : null)),
    checks && hasChecks ? h('div', { className: 'bt-goal-ckbody' },
      goal.objective ? sec('objective', t('Objective'), goal.objective) : null,
      goal.deliverables?.length > 0
        ? h('div', { key: 'deliverables', className: 'bt-goal-sec' },
          h('div', { className: 'bt-goal-sub' }, '结果'),
          h('ul', { className: 'bt-goal-rules' }, goal.deliverables.map((item, index) => h('li', { key: index }, item))))
        : null,
      h('div', { key: 'checks', className: 'bt-goal-sec' },
        h('div', { className: 'bt-goal-sub' }, '检查'),
        goal.checks?.length > 0
          ? goal.checks.map(check => h('div', { key: `check-${check.stage}`, className: 'bt-goal-check' },
            h('code', null, check.command),
            h('span', { 'data-pass': check.ran ? check.passed : undefined }, check.passed ? '通过' : check.ran ? '没通过' : '还没跑'),
            h('span', { className: 'bt-goal-check-exit' }, check.exit === null ? '没有退出码' : `退出码 ${check.exit}`)))
          : h('div', { className: 'bt-goal-check' }, '由你看过结果后确认')),
      goal.constraints?.length > 0 ? sec('rules', t('Rules'), h('ul', { className: 'bt-goal-rules' },
        goal.constraints.map((rule, i) => h('li', { key: i }, rule)))) : null) : null),
    room.needsYou?.kind === 'signoff' && typeof actions.advance === 'function'
      ? h('div', { className: 'bt-goal-actions' },
        h('button', { type: 'button', className: 'bt-goal-primary', onClick: () => actions.advance() }, t('Continue')))
      : null,
    h('div', { className: 'bt-goal-foot' },
      hasChecks ? h('button', {
        type: 'button', className: 'bt-goal-checks', 'aria-expanded': checks, onClick: () => setChecks(!checks),
      }, h('span', { className: 'bt-goal-mchev', 'aria-hidden': true }, h(ChevronDownIcon)), t('Goal and checks')) : h('span'),
      h('span', { className: 'bt-goal-facts' })))
}

// The surface that wraps the capsule: signal or panel hangs under it. Closed
// is a 40px capsule; a signal makes it grow one row; open shows the panel.
export function GoalIsland({ room, goal, view, mode, signal, roomWork, roster, actions, pill }) {
  const island = useRef(null)
  const open = mode === 'open'
  const wasOpen = useRef(open)
  useMorph(island, `${mode}:${signal?.key ?? ''}`)
  // The closed capsule and the open header are different buttons; keep keyboard
  // focus on the disclosure control across the swap instead of dropping it.
  useEffect(() => {
    if (wasOpen.current === open) return
    wasOpen.current = open
    const target = island.current?.querySelector(open ? '.bt-pill' : '.bt-goal-closed')
    if (target instanceof HTMLElement) target.focus({ preventScroll: true })
  }, [open])
  const working = new Set((roomWork ?? []).map(entry => entry.botId))
  return h('div', {
    ref: island,
    className: 'bt-island',
    'data-goal': view?.status,
    'data-idle': view?.idle || undefined,
    'data-mode': mode,
    'data-signal': signal?.kind,
    'data-signal-key': signal?.key,
  },
  open ? h(GoalOutside, { island, close: actions.closeGoal }) : null,
  open ? pill : null,
  h('div', { className: 'bt-goal-pod' },
    open
      ? (view === null ? null : h(GoalPanel, { goal, view, room, roster, actions, working }))
      : h(Fragment, null,
        h(GoalClosed, { view, room, actions }),
        signal === null || signal === undefined
          ? null
          : h(GoalSignal, { signal, mode, actions }))))
}

export const GOAL_CSS = `
/* One surface: the pill's own background, border and shadow. The pill row is
   40px, the pod bar 30px; the surface reshapes on SPRING_SHAPE. */
.bt-island{position:relative;z-index:6;align-self:flex-start;display:flex;flex-direction:column;pointer-events:auto;width:min(440px,calc(100% - 120px));background:var(--bt-card);border:.5px solid var(--bt-line-2);border-radius:20px;box-shadow:var(--bt-island-shadow);color:var(--bt-ink);font-family:inherit;font-size:13.5px;line-height:20px;box-sizing:border-box;transition:${spring(SPRING_SHAPE, 'width', 'border-radius')}}
.bt-island[data-mode=peek],.bt-island[data-mode=decision]{width:min(480px,calc(100% - 120px));border-radius:18px}
.bt-island[data-mode=open]{width:min(560px,calc(100% - 48px));border-radius:18px}
.bt-island[data-morph]{overflow:hidden}
.bt-island .bt-pill{width:100%;max-width:none;background:none;border:0;box-shadow:none;border-radius:20px 20px 0 0}
.bt-island[data-mode=open] .bt-pill{border-radius:18px 18px 0 0}
.bt-island .bt-pill:hover{background:var(--bt-hover)}
.bt-island .bt-pill:active{transform:none}
.bt-pill-goal{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 auto;text-align:left}
.bt-pill-ico{flex:none;display:inline-flex;width:14px;height:14px;color:var(--bt-accent)}
.bt-pill-ico svg{width:14px;height:14px}
.bt-pill-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.bt-pill-count{flex:none;font-size:12.5px;line-height:16px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
.bt-goal-pod{display:flex;flex-direction:column;min-width:0}
.bt-island[data-mode=open] .bt-goal-pod::before{content:"";flex:none;height:.5px;margin:0 12px;background:var(--bt-line)}
.bt-goal-chev{flex:none;display:inline-flex;color:var(--bt-ink-3)}
.bt-goal-chev svg{width:14px;height:14px;transition:${spring(SPRING_SHAPE, 'transform')}}
.bt-island[data-mode=open] .bt-pill .bt-goal-chev svg{transform:rotate(180deg)}
.bt-goal-closed{display:flex;flex-direction:column;width:100%;padding:0;border:0;border-radius:20px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background-color .12s ease}
.bt-goal-closed:hover{background:var(--bt-hover)}
.bt-goal-closed:active{background:var(--bt-active)}
.bt-goal-closed-main{display:flex;align-items:center;gap:8px;min-width:0;height:40px;padding:7px 12px 7px 8px;box-sizing:border-box}
.bt-goal-closed-ico{flex:none;display:inline-flex;color:var(--bt-accent)}
.bt-goal-closed-ico svg{width:15px;height:15px}
.bt-goal-closed-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:650;color:var(--bt-ink)}
.bt-goal-closed-count{flex:none;font-size:12px;line-height:16px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums}
.bt-goal-closed-sub{flex:none;display:inline-flex;align-items:center;gap:6px;max-width:38%;min-width:0;font-size:12.5px;line-height:16px;color:var(--bt-ink-3)}
.bt-goal-closed-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-goal-closed-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--bt-green)}
.bt-goal-closed-dot[data-tone=drafting],.bt-goal-closed-dot[data-tone=active]{background:var(--bt-accent)}
.bt-goal-closed-dot[data-tone=waiting]{background:var(--bt-star)}
.bt-goal-closed-dot[data-tone=stopped]{background:var(--bt-ink-3)}
.bt-goal-closed-dot[data-live]{animation:bt-live-pulse 1.4s ease-in-out infinite}
.bt-goal-closed-main .bt-goal-chev{margin-left:2px}
.bt-goal-closed-segs{display:flex;gap:3px;width:100%;padding:0 16px 8px;box-sizing:border-box}
.bt-goal-closed-segs i{flex:1 1 0;height:3px;border-radius:999px;background:var(--bt-line-2);transition:background-color .3s ease}
.bt-goal-closed-segs i[data-seg=done]{background:var(--bt-green)}
.bt-goal-closed-segs i[data-seg=current]{background:var(--bt-accent)}
.bt-goal-closed-segs i[data-seg=checking]{background:var(--bt-accent);opacity:.6}
.bt-goal-closed-segs i[data-seg=paused]{background:var(--bt-star)}
.bt-goal-signal{display:flex;align-items:center;min-width:0;border-radius:0 0 20px 20px;animation:bt-signal-in .18s ease-out}
.bt-goal-signal-main{flex:1 1 auto;display:flex;align-items:center;gap:8px;min-width:0;height:40px;padding:0 8px 0 14px;border:0;border-radius:0 0 20px 20px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.bt-goal-signal-main:hover{background:var(--bt-hover)}
.bt-goal-signal-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--bt-accent)}
.bt-goal-signal[data-tone=waiting] .bt-goal-signal-dot{background:var(--bt-star)}
.bt-goal-signal[data-tone=done] .bt-goal-signal-dot{background:var(--bt-green)}
.bt-goal-signal[data-tone=paused] .bt-goal-signal-dot{background:var(--bt-danger-text)}
.bt-goal-signal[data-tone=active] .bt-goal-signal-dot{background:var(--bt-accent)}
.bt-goal-signal-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:17px;color:var(--bt-ink-2)}
.bt-goal-signal-go{flex:none;font-size:12.5px;line-height:17px;color:var(--bt-accent)}
.bt-goal-signal-close{flex:none;width:28px;height:28px;margin-right:4px;border:0;border-radius:50%;background:none;color:var(--bt-ink-3);font:inherit;font-size:16px;line-height:1;cursor:pointer}
.bt-goal-signal-close:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-goal-meta{margin:8px 14px 0;padding:5px 9px;border-radius:8px;background:var(--bt-shade-2);color:var(--bt-ink-2);font-size:12.5px;line-height:17px}
.bt-goal-warn{margin:8px 14px 0;padding:6px 9px;border-left:2px solid var(--bt-line-warning);border-radius:0 8px 8px 0;background:var(--bt-warning-wash);color:var(--bt-warning-text);font-size:12.5px;line-height:17px}
.bt-goal-actions{display:flex;gap:8px;padding:8px 14px 10px;border-top:.5px solid var(--bt-line)}
.bt-goal-primary{height:var(--bt-control-h-lg);padding:0 14px;border:1px solid var(--bt-accent);border-radius:8px;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;transition:filter .12s ease}
.bt-goal-primary:hover{filter:brightness(1.06)}
.bt-goal-primary:not(:disabled):active{filter:brightness(.92)}
.bt-goal-panel{display:flex;flex-direction:column;max-height:min(62vh,520px);overflow:hidden;border-radius:0 0 18px 18px;animation:bt-veil-in .22s ease-out backwards}
.bt-goal-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden}
/* The stepper: one shrinking node per stage on a hairline. */
.bt-goal-steps{display:flex;align-items:center;gap:6px;padding:10px 14px 0}
.bt-goal-step{position:relative;flex:1 1 0;min-width:20px;height:28px;display:flex;align-items:center;justify-content:center;border:0;background:none;cursor:pointer;padding:0}
.bt-goal-step::before{content:"";position:absolute;left:-3px;right:-3px;top:50%;height:1px;background:var(--bt-line-2)}
.bt-goal-step:first-child::before{left:50%}
.bt-goal-step:last-child::before{right:50%}
.bt-goal-node{position:relative;z-index:1;box-sizing:border-box;width:min(20px,100%);aspect-ratio:1;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--bt-main);border:1.5px solid var(--bt-line-2);color:var(--bt-ink-3);font-size:10px;line-height:1;font-variant-numeric:tabular-nums}
.bt-goal-node>svg{flex:none;width:min(12px,70%);height:auto}
.bt-goal-step[data-step=passed]>.bt-goal-node{background:var(--bt-green);border-color:var(--bt-green);color:var(--bt-main)}
.bt-goal-step[data-step=current]>.bt-goal-node{border-color:var(--bt-accent);color:var(--bt-accent);font-weight:600}
.bt-goal-step[data-step=waiting]>.bt-goal-node{border-color:var(--bt-star);color:var(--bt-warning-text);font-weight:600}
.bt-goal-step[data-sel]:not([aria-current])>.bt-goal-node{box-shadow:0 0 0 1.5px var(--bt-ink)}
.bt-goal-step.bt-goal-mini .bt-goal-node{font-size:0}
.bt-goal-step.bt-goal-mini .bt-goal-node>svg{display:none}
.bt-goal-step::after{content:"";position:absolute;inset:-4px -3px}
/* The selected stage below the stepper. */
.bt-goal-bstage{display:flex;flex-direction:column;padding:4px 14px 14px;font-size:13.5px;line-height:18px;animation:bt-veil-in .22s ease-out backwards}
.bt-goal-bline{display:flex;align-items:baseline;gap:8px}
.bt-goal-btitle{flex:1 1 auto;font-weight:600}
.bt-goal-back{flex:none;border:0;background:none;padding:0;font:inherit;font-size:12.5px;line-height:16px;color:var(--bt-accent);cursor:pointer}
.bt-goal-btext{overflow-wrap:anywhere}
.bt-goal-line{margin-top:2px;min-width:0;font-size:12.5px;line-height:18px;color:var(--bt-ink-2);overflow-wrap:anywhere}
.bt-goal-sec{display:flex;flex-direction:column;gap:4px;min-width:0}
.bt-goal-sub{flex:none;font-size:12.5px;line-height:16px;font-weight:600;color:var(--bt-ink-2)}
.bt-goal-rw{margin-top:8px;border-radius:8px;padding:6px 10px;background:var(--bt-warning-wash);font-size:12.5px;line-height:18px;color:var(--bt-ink);overflow-wrap:anywhere}
.bt-goal-text{overflow-wrap:anywhere}
.bt-goal-rules{margin:0;padding-left:18px}
.bt-goal-check{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px 9px;font-size:12.5px;line-height:18px;color:var(--bt-ink-2);min-width:0}
.bt-goal-check code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--bt-ink);overflow-wrap:anywhere}
.bt-goal-check span[data-pass=true]{color:var(--bt-success-text);font-weight:650}
.bt-goal-check span[data-pass=false]{color:var(--bt-danger-text);font-weight:650}
.bt-goal-check-exit{color:var(--bt-ink-3)}
.bt-goal-evi{margin-top:8px;font-size:12.5px;line-height:18px;color:var(--bt-ink-2);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.bt-goal-tasks{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.bt-goal-task{display:flex;align-items:flex-start;gap:8px;min-width:0}
.bt-goal-task[data-task=pending]{opacity:.55}
.bt-goal-tav{position:relative;flex:none;display:inline-flex;margin-top:1px}
.bt-goal-tdone{position:absolute;right:-2px;bottom:-2px;width:12px;height:12px;border-radius:50%;background:var(--bt-green);color:var(--bt-main);display:inline-flex;align-items:center;justify-content:center;box-shadow:0 0 0 1.5px var(--bt-main)}
.bt-goal-tdone svg{width:9px;height:9px}
.bt-goal-ttext{flex:0 1 auto;min-width:0;overflow-wrap:anywhere}
.bt-goal-tname{font-weight:500}
.bt-goal-ckbody{display:flex;flex-direction:column;gap:10px;padding:0 14px 10px;font-size:13.5px;line-height:18px;text-align:left}
/* The bottom row: disclosure on the left, controls on the right. */
.bt-goal-foot{display:flex;align-items:center;gap:8px;height:40px;flex:none;padding:0 8px 0 14px;border-top:.5px solid var(--bt-line)}
.bt-goal-checks{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:4px 6px;margin-left:-6px;border-radius:6px;font:inherit;font-size:12.5px;line-height:16px;color:var(--bt-ink-2);cursor:pointer}
.bt-goal-checks:hover{background:var(--bt-hover)}
.bt-goal-mchev{display:inline-flex;width:14px;height:14px;color:var(--bt-ink-3)}
.bt-goal-mchev svg{width:14px;height:14px;transition:${spring(SPRING_SHAPE, 'transform')}}
.bt-goal-checks[aria-expanded=true] .bt-goal-mchev svg{transform:rotate(180deg)}
.bt-goal-facts{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto}
.bt-goal-compose{display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.bt-goal-clabel{font-size:12.5px;line-height:16px;font-weight:600;color:var(--bt-ink-2)}
.bt-goal-input{min-height:52px;max-height:124px;resize:none;font-size:13.5px}
.bt-goal-chint{font-size:12.5px;line-height:16px;color:var(--bt-ink-3)}
.bt-goal-cbtns{display:flex;justify-content:flex-end;gap:6px}
.bt-event .bt-event-ico{display:inline-flex;width:14px;height:14px;color:var(--bt-accent)}
@keyframes bt-signal-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@keyframes bt-live-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
@media (prefers-reduced-motion:reduce){.bt-island,.bt-goal-chev svg{transition:none!important}.bt-goal-panel,.bt-goal-signal{animation:none}.bt-goal-closed-dot[data-live]{animation:none}.bt-goal-closed-segs i{transition:none}}
`
