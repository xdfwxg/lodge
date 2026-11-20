// Lodge's goal island. The original capsule and spring idea started in
// Fei2411/DS-Bot (Apache-2.0); this surface has since been rewritten and is
// maintained here. See third_party/THIRD_PARTY_NOTICES.md.

import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { CheckIcon } from './glyphs.js'
import { useEscape } from './dismiss.js'
import { SPRING_SHAPE, spring, useMorph } from './motion.js'
import { t } from './copy.js'
import { IslandCat } from './cat.js'

// -------------------------------------------------------------------------
// The header island is the room's status screen. One surface wraps the
// current step and progress with a pod hanging under it — a live bar while
// closed, the full plan while open. `goalView` derives everything shown as
// plain data.

const RUNNING = new Set(['active', 'paused'])

// What the island and panel draw, as plain data: the goal, its stages and where
// the work stands. Everything else belongs in the room.
export function goalView(goal) {
  if (goal === null || goal === undefined) return null
  const stages = goal.stages ?? []
  const count = stages.length
  const at = goal.current
  const current = RUNNING.has(goal.status) ? stages[at] : undefined
  // The capsule counts the stage the goal is at, not the stages done.
  const number = goal.status === 'drafting' ? undefined
    : goal.status === 'stopped' ? stages.filter(stage => stage.status === 'passed').length
      : current !== undefined ? at + 1
        : count
  const barLabel = goal.barLabel !== undefined
    ? goal.barLabel
    : goal.status === 'drafting' ? t('Aligning the goal with you')
      : goal.status === 'stopped' ? t('Stopped')
        : goal.status === 'complete' ? ''
          : goal.status === 'paused' ? (current ? t('Paused · {title}', { title: current.title }) : t('Paused'))
            : goal.idle === true ? (current ? t('Waiting for you · {title}', { title: current.title }) : t('Waiting for you'))
              : current === undefined ? t('All stages done')
                : current.title
  const segments = stages.map((stage, i) => (stage.status === 'passed' ? 'done'
    : i === at && (goal.status === 'paused' || goal.idle === true) ? 'paused'
      : i === at && goal.status === 'active' ? 'current'
        : 'todo'))
  const stageViews = stages.map((stage, i) => ({
    n: i + 1,
    title: stage.title,
    status: stage.status,
    kind: stage.status === 'passed' ? 'passed'
      : i === at && RUNNING.has(goal.status) ? 'current'
        : 'upcoming',
  }))
  return {
    status: goal.status, idle: goal.idle === true, kind: goal.kind ?? null, title: goal.title ?? '',
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

const ChatMark = () => h('svg', {
  className: 'bt-goal-chat-mark',
  viewBox: '0 0 20 20',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
},
h('path', { d: 'M6 4.5h8a2.8 2.8 0 0 1 2.8 2.8v4a2.8 2.8 0 0 1-2.8 2.8h-4l-3.4 2.4v-2.4H6A2.8 2.8 0 0 1 3.2 11.3v-4A2.8 2.8 0 0 1 6 4.5z' }),
h('path', { d: 'M6.8 8.3h6.4M6.8 10.9h4.1' }))

// Closed: the goal stays the kicker, the current step leads. The ring around
// the mark is the stage track, so progress reads at a glance without a second row.
function GoalClosed({ view, room, actions, compact = false, plan = false, mini = false }) {
  const chat = view?.kind === 'chat'
  const title = view?.title || room.name || '目标'
  const status = view?.barLabel || room.needsYou?.label
    || (view?.status === 'complete' ? '已完成 · 看结果' : '还没有目标')
  const tone = view?.status === 'complete' ? 'done'
    : view?.status === 'stopped' ? 'stopped'
      : view?.status === 'paused' || view?.idle === true || room.needsYou ? 'waiting'
        : view?.status === 'drafting' ? 'drafting' : 'active'
  const total = view?.count ?? 0
  const done = (view?.segments ?? []).filter(seg => seg === 'done').length
  const currentIndex = (view?.number ?? 0) - 1
  const stages = view?.stages ?? []
  const nextStage = currentIndex >= 0 ? stages[currentIndex + 1] : stages[0]
  const nextTitle = nextStage?.title ?? ''
  const atLast = stages.length > 0 && currentIndex === stages.length - 1
  const radius = 15.5
  const circumference = 2 * Math.PI * radius
  const miniLabel = room.lodge === true ? '空闲中' : title
  const label = mini ? (room.lodge === true ? `${title} · 空闲中` : title) : `${title} · ${status}`
  return h('button', {
    type: 'button',
    className: 'bt-goal-closed',
    'data-compact': compact ? 'true' : undefined,
    'aria-expanded': false,
    'aria-label': label,
    title: label,
    onClick: () => actions.toggleGoal(room.id),
  },
  h('span', { className: 'bt-goal-closed-main' },
    mini
      ? h(Fragment, null,
        h('span', { className: 'bt-goal-mini-dot', 'aria-hidden': true }),
        h('span', { className: 'bt-goal-mini-title' }, miniLabel))
      : h(Fragment, null,
        h('span', {
          className: 'bt-goal-closed-ico',
          'data-tone': tone,
          'data-chat': chat ? 'true' : undefined,
          'data-live': (room.busyMembers ?? []).length > 0 || room.working === true ? 'true' : undefined,
          'data-track': !chat && total > 0 ? 'true' : undefined,
          'aria-hidden': true,
        },
        chat
          ? h(ChatMark)
          : h(Fragment, null,
            h('svg', { className: 'bt-goal-ring', viewBox: '0 0 36 36' },
              h('circle', { className: 'bt-ring-track', cx: 18, cy: 18, r: radius, fill: 'none', strokeWidth: 2 }),
              total === 0 ? null : h('circle', {
                className: 'bt-ring-fill', cx: 18, cy: 18, r: radius, fill: 'none', strokeWidth: 2.5,
                strokeLinecap: 'round', transform: 'rotate(-90 18 18)',
                strokeDasharray: `${circumference * (done / total)} ${circumference}`,
              })),
            h('span', { key: view?.number ?? 'none', className: 'bt-goal-ico-num' }, view?.number ?? '·')),
        h('i', { className: 'bt-goal-closed-pip' })),
        h('span', { className: 'bt-goal-closed-copy' },
          compact ? null : h('span', { className: 'bt-goal-closed-kicker' }, title),
          h('span', { className: 'bt-goal-closed-title' }, status))),
    plan && stages.length > 0
      ? h('span', { className: 'bt-goal-plan' },
        h('span', { className: 'bt-goal-plan-rail', 'aria-hidden': true },
          stages.map((stageView, index) => h('i', {
            key: stageView.n,
            className: 'bt-goal-plan-node',
            'data-state': stageView.status === 'passed' ? 'done'
              : index === currentIndex ? 'current' : 'todo',
          }, stageView.status === 'passed' ? h(CheckIcon) : h('span', { className: 'bt-goal-plan-n' }, stageView.n)))),
        nextTitle === '' && !atLast
          ? null
          : h('span', { className: 'bt-goal-plan-next' },
            nextTitle === '' ? null : h('span', { className: 'bt-goal-plan-k' }, '下一步'),
            h('span', { className: 'bt-goal-plan-t' }, nextTitle === '' ? '最后一步' : nextTitle)))
      : null))
}

// A single line under the capsule: one thing happened, one way to look at it.
// Decisions keep the line until they are handled; milestones expire.
function GoalSignal({ signal, mode, actions }) {
  const inside = event => event.currentTarget.contains(event.relatedTarget)
  const reviewTimeout = signal.needs === 'review-timeout'
  const dot = h('span', { className: 'bt-goal-signal-dot', 'aria-hidden': true })
  const text = h('span', { className: 'bt-goal-signal-text' }, signal.title)
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
  reviewTimeout
    ? h('div', {
      className: 'bt-goal-signal-main',
      'data-static': 'true',
      title: signal.detail,
    }, dot, text)
    : h('button', {
      type: 'button',
      className: 'bt-goal-signal-main',
      title: signal.detail,
      onClick: actions.actSignal,
    }, dot, text, h('span', { className: 'bt-goal-signal-go' }, signal.kind === 'decision' ? '去处理' : '查看')),
  reviewTimeout
    ? h('div', { className: 'bt-goal-signal-actions' },
      h('button', {
        type: 'button',
        className: 'bt-goal-signal-action',
        'data-primary': 'true',
        onClick: () => actions.actSignal('verify'),
      }, '再叫一次复核'),
      h('button', {
        type: 'button',
        className: 'bt-goal-signal-action',
        onClick: () => actions.actSignal('rework'),
      }, '退回重做'))
    : null,
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

// The open pod is a progress card: the goal in full, its steps, and where the
// work stands. Evidence, results and member details stay in the room.
function GoalPanel({ goal, view, room, actions }) {
  // 收件箱：一行放一条，第一条同时也在信号行和胶囊上；只有一条时不重复列。
  const attention = Array.isArray(room.attention) && room.attention.length > 0
    ? room.attention
    : room.needsYou ? [room.needsYou] : []
  // 一条是子房的事也照样列出来，否则只看一行 label 会以为是自己这层的。
  const listAttention = attention.length > 1
    || (attention.length === 1 && typeof attention[0].roomId === 'string')
  const at = RUNNING.has(view.status) && goal.current < view.stages.length ? goal.current : -1
  const [selected, setSelected] = useState(at)
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
  const stateLabel = stage === undefined ? ''
    : stage.status === 'passed' ? '已完成'
      : stage.status === 'active' ? '正在做' : '还没到'
  return h('div', { className: 'bt-goal-panel', role: 'region', 'aria-label': view.title },
    h('div', { className: 'bt-goal-body' },
    goal.objective ? h('div', { className: 'bt-goal-goal' }, goal.objective) : null,
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
    listAttention
      ? h('div', { key: 'attention', className: 'bt-goal-att' },
        h('div', { className: 'bt-goal-sub' }, '需要你'),
        attention.map((item, index) => h('button', {
          key: `${item.kind ?? ''}:${item.roomId ?? ''}:${item.stage ?? '-'}:${index}`,
          type: 'button',
          className: 'bt-goal-att-row',
          onClick: () => actions.openItem?.(item),
        },
        h('span', { className: 'bt-goal-att-name' }, item.roomName ?? ''),
        h('span', { className: 'bt-goal-att-label' }, item.label ?? '待处理'),
        h('span', { className: 'bt-goal-att-go' }, '去处理'))))
      : room.needsYou?.label ? h('div', { className: 'bt-goal-warn' }, room.needsYou.label) : null,
    stage === undefined ? null : h('div', { key: `s${selected}`, className: 'bt-goal-bstage' },
      h('div', { className: 'bt-goal-bline' },
        h('span', { className: 'bt-goal-btitle' }, stage.title),
        selected !== at && at >= 0 ? h('button', { type: 'button', className: 'bt-goal-back', onClick: () => setSelected(at) }, t('Back to current stage')) : null),
      h('div', { className: 'bt-goal-state', 'data-state': stage.status }, stateLabel))))
}

// The surface that wraps the capsule: signal or panel hangs under it. Closed
// is a 40px capsule; a signal makes it grow one row; open shows the panel.
export function GoalIsland({ room, goal, view, mode, signal, actions, pill, catState = 'rest' }) {
  const island = useRef(null)
  const open = mode === 'open'
  // 收成小药囊；鼠标移上去或键盘聚焦时展开，有事件时一直展开。
  const [peeking, setPeeking] = useState(false)
  const compact = !open && (signal === null || signal === undefined) && !peeking
  // 回合跑起来时展开；结束再停留一小会儿，然后回到最小。
  const [flash, setFlash] = useState(false)
  const wasWorking = useRef(room.working === true)
  useEffect(() => {
    if (room.working === true) {
      wasWorking.current = true
      setFlash(true)
      return undefined
    }
    if (!wasWorking.current) return undefined
    wasWorking.current = false
    const timer = setTimeout(() => setFlash(false), 1100)
    return () => clearTimeout(timer)
  }, [room.working])
  const mini = compact && view?.kind === 'chat' && room.working !== true && !flash
  // 阶段一变，岛面扫一次光；不循环，也不代替内容变化。
  const progressKey = `${view?.status ?? ''}:${(view?.segments ?? []).join('')}`
  const lastProgress = useRef(progressKey)
  const [sweeping, setSweeping] = useState(false)
  useEffect(() => {
    if (lastProgress.current === progressKey) return undefined
    lastProgress.current = progressKey
    setSweeping(true)
    const timer = setTimeout(() => setSweeping(false), 900)
    return () => clearTimeout(timer)
  }, [progressKey])
  const wasOpen = useRef(open)
  useMorph(island, `${mode}:${signal?.key ?? ''}:${compact ? 'c' : 'e'}`)
  // The closed capsule and the open header are different buttons; keep keyboard
  // focus on the disclosure control across the swap instead of dropping it.
  useEffect(() => {
    if (wasOpen.current === open) return
    wasOpen.current = open
    const target = island.current?.querySelector(open ? '.bt-pill' : '.bt-goal-closed')
    if (target instanceof HTMLElement) target.focus({ preventScroll: true })
  }, [open])
  return h('div', {
    ref: island,
    className: 'bt-island',
    'data-goal': view?.status,
    'data-idle': view?.idle || undefined,
    'data-mode': mode,
    'data-compact': compact ? 'true' : undefined,
    'data-mini': mini ? 'true' : undefined,
    'data-waiting': room.needsYou ? 'true' : undefined,
    'data-signal-tone': signal?.tone,
    'data-signal': signal?.kind,
    'data-signal-key': signal?.key,
    'data-sweep': sweeping ? 'true' : undefined,
    onPointerEnter: event => { if (event.pointerType !== 'touch') setPeeking(true) },
    onPointerLeave: () => setPeeking(false),
    onFocus: event => { if (event.target.matches(':focus-visible')) setPeeking(true) },
    onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) setPeeking(false) },
  },
  open ? h(GoalOutside, { island, close: actions.closeGoal }) : null,
  open ? pill : null,
  h('div', { className: 'bt-goal-pod' },
    open
      ? (view === null ? null : h(GoalPanel, { goal, view, room, actions }))
      : h(Fragment, null,
        h(GoalClosed, {
          view,
          room,
          actions,
          compact,
          mini,
          plan: !compact && goal.kind !== 'chat' && (signal === null || signal === undefined),
        }),
        signal === null || signal === undefined
          ? null
          : h(GoalSignal, { signal, mode, actions }))),
  mini ? null : h(IslandCat, { state: catState }))
}

export const GOAL_CSS = `
/* One surface: the island is the room's only glass object. The capsule shape,
   the pod and the open panel all reshape on the same spring. */
.bt-island{position:relative;z-index:6;align-self:flex-start;display:flex;flex-direction:column;pointer-events:auto;width:min(400px,calc(100% - 120px));--bt-island-glass:rgba(12,12,14,.94);--bt-island-glass-open:rgba(12,12,14,.98);--bt-island-fill:var(--bt-island-glass);--bt-island-sheen:rgba(255,255,255,.1);--bt-island-edge:color-mix(in srgb,var(--bt-ink) 11%,transparent);--bt-island-depth:0 1px 1px rgba(20,20,20,.04),0 12px 28px -12px rgba(20,20,20,.22),0 30px 60px -30px rgba(20,20,20,.32);--bt-island-depth-open:0 2px 4px rgba(20,20,20,.06),0 28px 64px rgba(20,20,20,.2);background:radial-gradient(130% 180% at 14% -55%,var(--bt-island-sheen),transparent 58%),var(--bt-island-fill);border:0;border-radius:999px;box-shadow:var(--bt-island-depth);-webkit-backdrop-filter:blur(24px) saturate(1.6);backdrop-filter:blur(24px) saturate(1.6);color:var(--bt-ink);font-family:inherit;font-size:var(--bt-text-label);line-height:20px;box-sizing:border-box;transition:${spring(SPRING_SHAPE, 'width', 'border-radius')},box-shadow .3s var(--bt-ease),background-color .3s var(--bt-ease)}
/* The one deep object in a light room: black glass, a green progress ring,
   and a single warm note when something waits. */
.bt-island{--bt-ink:#f5f5f7;--bt-ink-2:rgba(245,245,247,.72);--bt-ink-3:rgba(245,245,247,.46);--bt-ink-4:rgba(245,245,247,.32);--bt-line:rgba(255,255,255,.12);--bt-line-2:rgba(255,255,255,.18);--bt-main:#131316;--bt-card:#1a1a1e;--bt-hover:rgba(255,255,255,.07);--bt-active:rgba(255,255,255,.11);--bt-shade-2:rgba(255,255,255,.07);--bt-accent:#7fb2ff;--bt-accent-text:#c6dcff;--bt-accent-wash:rgba(99,148,255,.2);--bt-line-accent:rgba(127,178,255,.36);--bt-accent-ink:#0b111c;--bt-green:#3fd97a;--bt-star:#f6c453;--bt-warning-text:#f3c96d;--bt-warning-wash:rgba(246,196,83,.14);--bt-line-warning:rgba(246,196,83,.36);--bt-danger-text:#ff7c72;--bt-island-glass:rgba(12,12,14,.94);--bt-island-glass-open:rgba(12,12,14,.98);--bt-island-sheen:rgba(255,255,255,.1);--bt-island-edge:rgba(255,255,255,.14)}
.bt-island[data-signal-tone=paused] .bt-goal-signal-go{color:#ffb3ad;font-weight:600}
.bt-island[data-sweep]::after{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(100deg,transparent 22%,rgba(255,255,255,.16) 48%,transparent 74%);transform:translateX(-130%);animation:bt-island-sweep .9s var(--bt-ease) 1;pointer-events:none}
@keyframes bt-island-sweep{from{transform:translateX(-130%)}to{transform:translateX(130%)}}
.bt-island[data-sweep] .bt-goal-closed-ico{animation:bt-medal-pop .8s var(--bt-ease) 1}
@keyframes bt-medal-pop{0%,100%{transform:scale(1)}38%{transform:scale(1.06)}}
@keyframes bt-num-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
body[data-ds-dark-theme] .bt-island{--bt-ink:#fff4dc;--bt-ink-2:rgba(255,243,214,.74);--bt-ink-3:rgba(255,243,214,.48);--bt-ink-4:rgba(255,243,214,.32);--bt-line:rgba(236,203,128,.18);--bt-line-2:rgba(236,203,128,.26);--bt-hover:rgba(255,228,170,.08);--bt-active:rgba(255,228,170,.14);--bt-shade-2:rgba(255,228,170,.08);--bt-accent:#e8c47a;--bt-accent-text:#ffe6b0;--bt-accent-wash:rgba(232,196,122,.18);--bt-line-accent:rgba(232,196,122,.4);--bt-accent-ink:#241806;--bt-island-glass:rgba(23,18,11,.94);--bt-island-glass-open:rgba(23,18,11,.98);--bt-island-fill:rgba(23,18,11,.94);--bt-island-sheen:rgba(255,228,170,.22);--bt-island-edge:rgba(236,203,128,.55);--bt-island-depth:inset 0 0 0 1px rgba(236,203,128,.55),inset 0 1px 0 rgba(255,240,200,.16),0 2px 4px rgba(0,0,0,.5),0 24px 56px rgba(0,0,0,.65),0 0 26px -10px rgba(236,203,128,.4);--bt-island-depth-open:inset 0 0 0 1px rgba(236,203,128,.62),inset 0 1px 0 rgba(255,240,200,.2),0 4px 10px rgba(0,0,0,.5),0 32px 72px rgba(0,0,0,.7),0 0 32px -10px rgba(236,203,128,.45);background:radial-gradient(130% 180% at 14% -55%,var(--bt-island-sheen),transparent 58%),radial-gradient(90% 130% at 104% -18%,rgba(236,203,128,.18),transparent 62%),radial-gradient(120% 130% at 100% 130%,rgba(150,100,35,.16),transparent 64%),var(--bt-island-fill)}
.bt-island[data-mode=peek],.bt-island[data-mode=decision]{width:min(400px,calc(100% - 120px));border-radius:999px}
.bt-island[data-mode=open]{width:min(560px,calc(100% - 48px));border-radius:30px;box-shadow:var(--bt-island-depth-open);--bt-island-fill:var(--bt-island-glass-open)}
.bt-island[data-compact]{width:min(216px,calc(100% - 48px));border-radius:999px}
.bt-island[data-compact] .bt-goal-closed{border-radius:999px}
.bt-island[data-compact] .bt-goal-closed-main{height:44px;padding:5px 12px 5px 5px;gap:9px}
.bt-island[data-mini]{width:min(120px,calc(100% - 48px))}
.bt-island[data-mini] .bt-goal-closed-main{width:100%;height:32px;padding:0 14px;justify-content:center;gap:8px}
.bt-goal-mini-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--bt-green);box-shadow:0 0 10px color-mix(in srgb,var(--bt-green) 55%,transparent)}
.bt-goal-mini-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:16px;font-weight:600;color:var(--bt-ink)}
.bt-island[data-compact] .bt-goal-closed-copy{gap:0}
.bt-island[data-compact] .bt-goal-closed-title{font-size:13.5px;line-height:18px}
.bt-island[data-morph] .bt-goal-pod{overflow:hidden;border-radius:0 0 30px 30px}
.bt-island[data-morph] .bt-pill{overflow:hidden}
.bt-island .bt-pill{width:100%;max-width:none;background:none;border:0;box-shadow:none;border-radius:30px 30px 0 0;animation:bt-island-layer-in .24s var(--bt-ease) backwards}
.bt-island[data-mode=open] .bt-pill{border-radius:30px 30px 0 0}
.bt-island .bt-pill:hover{background:var(--bt-hover)}
.bt-island .bt-pill:active{transform:none}
.bt-pill-goal{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 auto;text-align:left}
.bt-pill-ico{flex:none;display:inline-flex;width:14px;height:14px;color:var(--bt-accent)}
.bt-pill-ico svg{width:14px;height:14px}
.bt-pill-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.bt-pill-count{flex:none;font-size:var(--bt-text-helper);line-height:16px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
.bt-goal-pod{display:flex;flex-direction:column;min-width:0}
.bt-island[data-mode=open] .bt-goal-pod::before{content:"";flex:none;height:.5px;margin:0 12px;background:var(--bt-line)}
.bt-goal-closed{display:flex;flex-direction:column;width:100%;padding:0;border:0;border-radius:999px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background-color .12s ease}
.bt-goal-closed:hover{background:var(--bt-hover)}
.bt-goal-closed:active{background:var(--bt-active)}
.bt-goal-closed-main{display:flex;align-items:center;gap:10px;min-width:0;height:54px;padding:8px 12px 8px 9px;box-sizing:border-box}
.bt-goal-closed-ico{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;color:var(--bt-accent-text);animation:bt-island-layer-in .26s var(--bt-ease) backwards}
.bt-goal-closed-ico::before{content:"";position:absolute;inset:4px;border-radius:50%;background:radial-gradient(120% 120% at 32% 18%,rgba(255,255,255,.34),var(--bt-accent-wash) 76%);box-shadow:inset 0 0 0 .5px var(--bt-line-accent),0 1px 2px rgba(0,0,0,.4)}
.bt-goal-closed-ico[data-chat=true]{width:30px;height:30px;color:var(--bt-ink-2)}
.bt-goal-closed-ico[data-chat=true]::before{display:none}
.bt-goal-chat-mark{display:block;width:18px;height:18px}
body[data-ds-dark-theme] .bt-goal-closed-ico[data-chat=true]{color:#f6dda6}
.bt-goal-ico-num{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;font-size:12.5px;line-height:18px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:var(--bt-ink);animation:bt-num-in .34s var(--bt-ease) 1}
.bt-goal-ring{position:absolute;inset:0;width:34px;height:34px;overflow:visible}
.bt-ring-track{stroke:var(--bt-line-2)}
.bt-ring-fill{stroke:var(--bt-green);filter:drop-shadow(0 0 2.5px color-mix(in srgb,var(--bt-green) 50%,transparent));transition:stroke-dasharray .7s var(--bt-ease)}
.bt-goal-closed-ico[data-tone=stopped] .bt-ring-fill{stroke:var(--bt-ink-3);filter:none}
.bt-goal-closed-pip{display:none}
.bt-goal-closed-ico[data-live] .bt-goal-closed-pip{display:block;position:absolute;right:0;bottom:0;width:8px;height:8px;border-radius:50%;background:var(--bt-green);box-shadow:0 0 0 2px var(--bt-card),0 0 6px color-mix(in srgb,var(--bt-green) 55%,transparent);animation:bt-live-pulse 1.4s ease-in-out infinite}
.bt-goal-closed-copy{display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-width:0;text-align:left;animation:bt-island-layer-in .26s var(--bt-ease) .02s backwards}
.bt-goal-closed-kicker{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--bt-text-helper);line-height:var(--bt-leading-helper);font-weight:500;letter-spacing:.01em;color:var(--bt-ink-3)}
.bt-goal-closed-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:19px;font-weight:600;color:var(--bt-ink)}

.bt-goal-plan{flex:none;display:flex;align-items:center;gap:10px;min-width:0;margin-left:auto;padding:0;animation:bt-island-layer-in .3s var(--bt-ease) .02s backwards}
.bt-goal-plan-rail{display:flex;align-items:center;flex:none}
.bt-goal-plan-node{position:relative;box-sizing:border-box;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1px solid var(--bt-line-2);color:var(--bt-ink-3);font-size:10px;line-height:1;font-style:normal;font-variant-numeric:tabular-nums;transition:background-color .45s var(--bt-ease),border-color .45s var(--bt-ease),box-shadow .45s var(--bt-ease)}
.bt-goal-plan-node>svg{flex:none;width:10px;height:10px}
.bt-goal-plan-node + .bt-goal-plan-node{margin-left:12px}
.bt-goal-plan-node + .bt-goal-plan-node::before{content:"";position:absolute;right:100%;top:50%;width:12px;height:1px;background:var(--bt-line-2);transform:translateY(-50%)}
.bt-goal-plan-node[data-state=done]{background:var(--bt-green);border-color:var(--bt-green);color:#0c2416}
.bt-goal-plan-node[data-state=current]{border-color:var(--bt-green);color:var(--bt-ink);box-shadow:0 0 0 2px rgba(63,217,122,.16),0 0 7px rgba(63,217,122,.45)}
.bt-goal-plan-node[data-state=todo]{opacity:.55}
.bt-goal-plan-next{flex:0 1 auto;display:flex;align-items:baseline;gap:8px;min-width:0;padding-left:10px}
.bt-goal-plan-k{flex:none;font-size:11px;line-height:16px;color:var(--bt-ink-3)}
.bt-goal-plan-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:17px;color:var(--bt-ink)}
.bt-goal-signal{display:flex;align-items:center;gap:6px;min-width:0;padding:0 10px 8px 16px;animation:bt-island-layer-in .26s var(--bt-ease) .03s backwards}
.bt-goal-signal-main{flex:1 1 auto;display:flex;align-items:center;gap:7px;min-width:0;height:24px;padding:0 5px;border:0;border-radius:7px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.bt-goal-signal-main:hover{background:var(--bt-hover)}
.bt-goal-signal-main[data-static=true]{cursor:default}
.bt-goal-signal-main[data-static=true]:hover{background:none}
.bt-goal-signal-dot{flex:none;width:5px;height:5px;border-radius:50%;background:var(--bt-accent)}
.bt-goal-signal[data-tone=waiting] .bt-goal-signal-dot{background:var(--bt-star)}
.bt-goal-signal[data-tone=done] .bt-goal-signal-dot{background:var(--bt-green)}
.bt-goal-signal[data-tone=paused] .bt-goal-signal-dot{background:var(--bt-danger-text)}
.bt-goal-signal[data-tone=active] .bt-goal-signal-dot{background:var(--bt-accent)}
.bt-goal-signal-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:16px;color:var(--bt-ink-2)}
.bt-goal-signal[data-tone=waiting] .bt-goal-signal-text{color:var(--bt-warning-text)}
.bt-goal-signal-go{flex:none;font-size:12px;line-height:16px;color:var(--bt-ink-3)}
.bt-goal-signal[data-tone=waiting] .bt-goal-signal-go{color:var(--bt-warning-text);font-weight:600}
.bt-goal-signal-actions{flex:none;display:flex;align-items:center;gap:6px}
.bt-goal-signal-action{height:24px;padding:0 8px;border:1px solid var(--bt-line-2);border-radius:7px;background:none;color:var(--bt-ink-2);font:inherit;font-size:11.5px;line-height:1;white-space:nowrap;cursor:pointer}
.bt-goal-signal-action:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-goal-signal-action[data-primary=true]{border-color:transparent;background:var(--bt-accent);color:var(--bt-accent-ink);font-weight:600}
.bt-goal-signal-close{flex:none;width:22px;height:22px;border:0;border-radius:6px;background:none;color:var(--bt-ink-3);font:inherit;font-size:15px;line-height:1;cursor:pointer}
.bt-goal-signal-close:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-goal-meta{margin:8px 14px 0;padding:5px 9px;border-radius:8px;background:var(--bt-shade-2);color:var(--bt-ink-2);font-size:var(--bt-text-helper);line-height:17px}
.bt-goal-warn{margin:8px 14px 0;padding:6px 9px;border-left:2px solid var(--bt-line-warning);border-radius:0 8px 8px 0;background:var(--bt-warning-wash);color:var(--bt-warning-text);font-size:var(--bt-text-helper);line-height:17px}
.bt-goal-att{display:flex;flex-direction:column;gap:2px;margin:8px 14px 0}
.bt-goal-att .bt-goal-sub{padding:0 2px 2px}
.bt-goal-att-row{display:flex;align-items:baseline;gap:8px;min-width:0;width:100%;padding:5px 8px;border:0;border-radius:8px;background:var(--bt-shade-2);color:var(--bt-ink);font:inherit;font-size:var(--bt-text-helper);line-height:17px;text-align:left;cursor:pointer}
.bt-goal-att-row:hover{background:var(--bt-hover)}
.bt-goal-att-name{flex:none;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.bt-goal-att-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bt-ink-2)}
.bt-goal-att-go{flex:none;color:var(--bt-accent)}
.bt-goal-actions{display:flex;gap:8px;padding:8px 14px 10px;border-top:.5px solid var(--bt-line)}
.bt-goal-primary{height:var(--bt-control-h-lg);padding:0 14px;border:1px solid var(--bt-accent);border-radius:8px;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);font:inherit;font-size:var(--bt-text-helper);font-weight:600;cursor:pointer;transition:filter .12s ease}
.bt-goal-primary:hover{filter:brightness(1.06)}
.bt-goal-primary:not(:disabled):active{filter:brightness(.92)}
.bt-goal-panel{display:flex;flex-direction:column;max-height:min(62vh,520px);overflow:hidden;border-radius:0 0 30px 30px;animation:bt-island-layer-in .28s var(--bt-ease) backwards}
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
.bt-goal-goal{margin:10px 14px 0;font-size:var(--bt-text-label);line-height:19px;overflow-wrap:anywhere}
.bt-goal-bstage{display:flex;flex-direction:column;padding:4px 14px 14px;font-size:var(--bt-text-label);line-height:18px;animation:bt-veil-in .22s ease-out backwards}
.bt-goal-bline{display:flex;align-items:baseline;gap:8px}
.bt-goal-btitle{flex:1 1 auto;font-weight:600}
.bt-goal-back{flex:none;border:0;background:none;padding:0;font:inherit;font-size:var(--bt-text-helper);line-height:16px;color:var(--bt-accent);cursor:pointer}
.bt-goal-state{margin-top:2px;font-size:var(--bt-text-helper);line-height:17px;color:var(--bt-ink-2)}
.bt-goal-sub{flex:none;font-size:var(--bt-text-helper);line-height:16px;font-weight:600;color:var(--bt-ink-2)}
.bt-goal-compose{display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.bt-goal-clabel{font-size:var(--bt-text-helper);line-height:16px;font-weight:600;color:var(--bt-ink-2)}
.bt-goal-input{min-height:52px;max-height:124px;resize:none;font-size:var(--bt-text-label)}
.bt-goal-chint{font-size:var(--bt-text-helper);line-height:16px;color:var(--bt-ink-3)}
.bt-goal-cbtns{display:flex;justify-content:flex-end;gap:6px}
.bt-event .bt-event-ico{display:inline-flex;width:14px;height:14px;color:var(--bt-accent)}
@keyframes bt-island-layer-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
@keyframes bt-live-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
@media (prefers-reduced-motion:reduce){.bt-island{transition:none!important}.bt-goal-panel,.bt-goal-signal,.bt-goal-plan,.bt-goal-closed-ico,.bt-goal-closed-copy,.bt-island .bt-pill{animation:none!important}.bt-goal-closed-ico[data-live] .bt-goal-closed-pip{animation:none!important}.bt-ring-fill{transition:none!important}.bt-island[data-sweep]::after{display:none!important}.bt-island[data-sweep] .bt-goal-closed-ico{animation:none!important}.bt-goal-ico-num{animation:none!important}}
`
