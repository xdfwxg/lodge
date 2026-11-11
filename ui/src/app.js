import { Fragment, createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { BotAvatar, BotMark, RoomAvatar } from './marks.js'
import { ArrowUpIcon } from './icons.js'
import { MarkdownText } from './primitives.js'
import { createStore, useStore } from './store.js'

const MD = { code: { copyLabel: '复制', copiedLabel: '已复制' } }
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

const timeOf = ts => {
  try {
    return clock.format(new Date(ts))
  } catch {
    return ''
  }
}

const money = micro => {
  const usd = micro / 1_000_000
  return `$${usd >= 1 ? usd.toFixed(2) : usd.toFixed(3)}`
}
const independenceOf = room => room.independenceLabel ?? '独立性未标注'
const NEEDS_TONE = {
  question: 'waiting',
  decision: 'waiting',
  signoff: 'done',
  review: 'checking',
  rework: 'paused',
  setup: 'waiting',
  idle: 'paused',
  merge: 'paused',
  parallel: 'paused',
  budget: 'paused',
}

const activeIndex = room => room.stages.findIndex(stage => stage.state === 'active')
const evidenceFor = (room, index) => room.messages.filter(message => (
  message.kind === 'evidence' && (message.meta?.stage ?? 0) === index
))
const verdictFor = (room, index) => [...room.messages].reverse().find(message => (
  message.kind === 'verdict' && (message.meta?.stage ?? 0) === index
))

const islandStatus = room => {
  if (room.state === 'complete') return { label: '目标达成', tone: 'done' }
  if (room.state === 'stopped') return { label: '已停止', tone: 'stopped' }
  if (room.state === 'paused') {
    return room.needsYou?.kind === 'idle' || room.needsYou?.kind === 'budget'
      ? { label: room.needsYou.label, tone: 'paused' }
      : { label: '已暂停', tone: 'paused' }
  }
  if (room.busy === true) {
    const busy = Array.isArray(room.busySeats) ? room.busySeats : room.busySeat ? [room.busySeat] : []
    if (busy.length > 1) return { label: `${busy.length} 个执行在做`, tone: 'active' }
    const seat = room.seatSpecs?.find(item => item.id === busy[0])?.name
    return { label: `${seat ?? '席位'}在做`, tone: 'active' }
  }
  if (room.needsYou) {
    return { label: room.needsYou.label, tone: NEEDS_TONE[room.needsYou.kind] ?? 'waiting' }
  }
  return { label: '进行中', tone: 'active' }
}

const trackTone = (room, stage, index) => {
  if (stage.state === 'passed') return 'passed'
  if (stage.state !== 'active') return 'pending'
  if (room.state === 'paused') return 'paused'
  if (room.needsYou?.stage === index && room.needsYou.kind === 'review') return 'checking'
  return 'active'
}

const seatRole = (room, seatId) => (
  room.seatSpecs?.find(seat => seat.id === seatId)?.role
  ?? (seatId === 'planner' ? 'lead' : seatId === 'verifier' ? 'verifier' : 'worker')
)
const leadOf = room => room.leadSeat ?? 'planner'
const workerOf = room => room.workers?.[0] ?? 'executor'
const verifierOf = room => room.verifiers?.[0] ?? null

const workingSeats = (room, index) => {
  if (room.state !== 'active') return []
  if (room.live === true) return Array.isArray(room.busySeats) ? room.busySeats : room.busySeat ? [room.busySeat] : []
  const stage = room.stages[index]
  if (stage === undefined) return []
  if (room.openQuestion) return [leadOf(room)]
  if (stage.kind === 'decision') return [leadOf(room)]
  const verdict = verdictFor(room, index)
  if (verdict !== undefined) return []
  if (evidenceFor(room, index).length === 0) return room.workers ?? [workerOf(room)]
  const verifier = verifierOf(room)
  return verifier === null ? [] : [verifier]
}

const seatTask = (seat, stage) => {
  if (seat.role === 'lead') {
    return stage.kind === 'decision' ? '讲清「做到什么算过」，等你拍板' : '拆出这一段的写范围与验收'
  }
  if (seat.role === 'worker') {
    return stage.acceptance ? `按 \`${stage.acceptance}\` 交付` : '交付这一步的产物'
  }
  if (seat.role === 'verifier') return '独立复跑，给 PASS 或 REJECT'
  return '只读观察'
}

const seatState = (room, stage, index, seatId) => {
  const busy = Array.isArray(room.busySeats) ? room.busySeats : room.busySeat ? [room.busySeat] : []
  if (busy.includes(seatId)) return 'working'
  if (stage.state === 'passed') return 'done'
  if (stage.state === 'pending') return 'pending'
  if (room.state === 'paused' || room.state === 'stopped') return 'paused'
  const evidence = evidenceFor(room, index)
  const verdict = verdictFor(room, index)
  const role = seatRole(room, seatId)
  const seatEvidence = room.messages.some(message => (
    message.kind === 'evidence' && message.authorId === seatId && (message.meta?.stage ?? 0) === index
  ))
  if (role === 'lead') return stage.kind === 'decision' ? (room.live === true ? 'idle' : 'working') : 'done'
  if (role === 'worker') {
    if (seatEvidence) return 'done'
    if (stage.kind !== 'deliverable') return 'pending'
    return room.live === true ? 'idle' : 'working'
  }
  if (role === 'verifier') {
    if (verdict !== undefined) return 'done'
    if (evidence.length === 0) return 'pending'
    return room.live === true ? 'idle' : 'working'
  }
  return 'idle'
}

const STAGE_KIND = { decision: '决策 · 你确认才算过', deliverable: '交付 · 命令与证据说话' }

function StageStep({ stage, index, selected, onSelect }) {
  return h('button', {
    type: 'button',
    className: 'crew-step-node',
    'data-state': stage.state,
    'data-selected': selected,
    onClick: onSelect,
    title: stage.title,
  },
  h('span', { className: 'crew-step-mark' }, stage.state === 'passed' ? '✓' : String(index + 1)),
  h('span', { className: 'crew-step-label' }, stage.title))
}

function IslandStage({ room, index, seats, onBack }) {
  const stage = room.stages[index]
  const evidence = evidenceFor(room, index)
  const verdict = verdictFor(room, index)
  const rejects = room.messages.filter(message => (
    message.kind === 'verdict' && message.meta?.pass === false && (message.meta?.stage ?? 0) === index
  ))
  const lastReject = rejects.at(-1)
  const brief = room.brief ?? null
  const conflict = room.mergeConflict?.stage === index
    ? room.mergeConflict
    : room.stageDispatch?.stage === index ? room.stageDispatch?.conflict ?? null : null

  return h('div', { className: 'crew-island-stage' },
    h('div', { className: 'crew-island-stage-head' },
      h('b', null, `${index + 1} ${stage.title}`),
      h('span', { className: 'crew-island-kind' }, STAGE_KIND[stage.kind] ?? '')),
    h('div', { className: 'crew-kv' },
      h('span', null, '做到什么算过'),
      stage.kind === 'deliverable'
        ? h('code', null, stage.acceptance ?? '未写验收命令')
        : h('span', { className: 'crew-island-soft' }, '你点过才算过')),
    conflict !== null
      ? h('div', { className: 'crew-island-rework' },
        h('span', null, '并行合并冲突 · 等你处理'),
        h('p', null, (conflict.files ?? []).join('、') || conflict.branch || '冲突文件未知'))
      : null,
    rejects.length > 0
      ? h('div', { className: 'crew-island-rework' },
        h('span', null, `返工 ${rejects.length} 次 · 验收席位打回`),
        lastReject?.text ? h('p', null, lastReject.text) : null)
      : null,
    evidence.length > 0
      ? h('div', { className: 'crew-island-evidence' },
        evidence.map(message => h('a', {
          key: message.id,
          className: 'crew-island-evidence-link',
          href: `/api/rooms/${room.id}/evidence/${message.id}`,
          target: '_blank',
          rel: 'noreferrer',
        }, message.meta?.kind === 'manual'
          ? '证据 · 产物就绪'
          : `证据 · ${message.meta?.command ?? '命令'} · exit ${message.meta?.exit ?? '—'}`)))
      : null,
    verdict !== undefined
      ? h('div', { className: 'crew-island-verdict', 'data-pass': verdict.meta?.pass === true },
        verdict.meta?.pass === true ? '验收席位已给 PASS' : '验收席位打回，等返工')
      : null,
    h('div', { className: 'crew-island-seats' },
      seats.map(seat => h('div', { key: seat.id, className: 'crew-island-seat', 'data-state': seatState(room, stage, index, seat.id) },
        h(BotAvatar, { bot: seat, size: 22, live: seatState(room, stage, index, seat.id) === 'working' }),
        h('span', { className: 'crew-island-seat-name' }, seat.name),
        h('span', { className: 'crew-island-seat-task' }, seatTask(seat, stage)),
        h('span', { className: 'crew-island-seat-state' },
          seatState(room, stage, index, seat.id) === 'done' ? '已交'
            : seatState(room, stage, index, seat.id) === 'working' ? '在做'
              : seatState(room, stage, index, seat.id) === 'idle' ? '待命'
                : seatState(room, stage, index, seat.id) === 'paused' ? '暂停'
                  : '未开始')))),
    h('details', { className: 'crew-island-checks' },
      h('summary', null, '目标与检查'),
      h('div', { className: 'crew-island-checks-body' },
        h('div', { className: 'crew-kv' }, h('span', null, 'objective'), h('span', null, brief?.objective || room.goal)),
        h('div', { className: 'crew-kv' }, h('span', null, 'done'),
          h('span', { className: 'crew-island-done' },
            (brief?.done ?? room.stages.map((item, at) => ({ done: item.state === 'passed', text: `${at + 1} ${item.title}` })))
              .map(item => h('span', { key: item.text, 'data-done': item.done }, `${item.done ? '✓' : '·'} ${item.text}`)))),
        (brief?.constraints ?? []).length > 0
          ? h('div', { className: 'crew-kv' }, h('span', null, 'constraints'),
            h('span', { className: 'crew-island-done' }, brief.constraints.map(text => h('span', { key: text }, `- ${text}`))))
          : null)),
    activeIndex(room) >= 0 && index !== activeIndex(room)
      ? h('button', { type: 'button', className: 'crew-ghost crew-island-back', onClick: onBack }, '回到当前阶段')
      : null)
}

function GoalIsland({ room, seats, advanced, onToggleAdvanced, store }) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState(null)
  const [armed, setArmed] = useState(false)
  const status = islandStatus(room)
  const current = activeIndex(room)
  const done = room.stages.filter(stage => stage.state === 'passed').length
  const progress = room.state === 'complete' ? room.stages.length : current >= 0 ? current + 1 : done
  const selected = picked ?? (current >= 0 ? current : room.stages.length - 1)
  const workers = workingSeats(room, current)
  const working = seats.filter(seat => workers.includes(seat.id))

  useEffect(() => {
    if (!armed) return undefined
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  const degraded = room.independence !== 'vendor'

  return h('header', { className: 'crew-head crew-island', 'data-open': open },
    h('div', {
      className: 'crew-island-top',
      role: 'button',
      tabIndex: 0,
      'aria-expanded': open,
      onClick: () => setOpen(value => !value),
      onKeyDown: event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setOpen(value => !value)
        }
      },
    },
    h('span', { className: 'crew-island-dot', 'data-tone': status.tone }),
    h('h1', null, room.name),
    degraded ? h('span', { className: 'crew-badge', 'data-warn': true }, independenceOf(room)) : null,
    room.demo === true ? h('span', { className: 'crew-badge' }, '演示') : null,
    room.imported === true ? h('span', { className: 'crew-badge' }, '交接 · 只读') : null,
    room.live === true && room.imported !== true ? h('span', { className: 'crew-badge' }, '实时') : null,
    h('span', { className: 'crew-island-pill' },
      `${progress}/${room.stages.length}`,
      h('span', { className: 'crew-island-chev', 'data-open': open }, '⌄'))),
    h('div', { className: 'crew-island-strip' },
      h('span', { className: 'crew-island-state', 'data-tone': status.tone }, status.label),
      h('div', { className: 'crew-island-track' }, room.stages.map((stage, index) => h('i', {
        key: stage.title,
        'data-tone': trackTone(room, stage, index),
      }))),
      working.length > 0
        ? h('div', { className: 'crew-island-faces' },
          working.slice(0, 4).map(seat => h(BotAvatar, { key: seat.id, bot: seat, size: 20, live: true })),
          working.length > 4 ? h('span', { className: 'crew-island-more' }, `+${working.length - 4}`) : null)
        : null),
    open
      ? h('div', { className: 'crew-island-panel' },
        h('div', { className: 'crew-island-steps' },
          room.stages.map((stage, index) => h(StageStep, {
            key: stage.title,
            stage,
            index,
            selected: index === selected,
            onSelect: () => setPicked(index),
          }))),
        room.stages[selected]
          ? h(IslandStage, {
            room,
            index: selected,
            seats,
            onBack: () => setPicked(current >= 0 ? current : null),
          })
          : null,
        h('div', { className: 'crew-island-foot' },
          h('button', { type: 'button', className: 'crew-ghost', onClick: onToggleAdvanced },
            advanced ? '收起高级' : '高级'),
          h('span', { className: 'crew-island-foot-space' }),
          room.imported === true
            ? h('span', { className: 'crew-ghost' }, '只读记录，不能继续操作')
            : null,
          room.imported !== true && room.state === 'active'
            ? h('button', { type: 'button', className: 'crew-ghost', onClick: () => void store.pause() }, '暂停')
            : null,
          room.imported !== true && room.state === 'paused'
            ? h('button', { type: 'button', className: 'crew-ghost', onClick: () => void store.resume() }, '继续')
            : null,
          room.imported !== true && (room.state === 'active' || room.state === 'paused')
            ? h('button', {
              type: 'button',
              className: 'crew-ghost',
              'data-armed': armed,
              onClick: () => {
                if (armed) {
                  setArmed(false)
                  void store.stop()
                } else {
                  setArmed(true)
                }
              },
            }, armed ? '再点一次确认停止' : '停止')
            : null))
      : null)
}

function Markdown({ text, variant }) {
  return h(MarkdownText, { text, labels: MD, variant })
}

function Speaker({ seat, ts }) {
  return h('div', { className: 'crew-speaker' },
    h('span', { className: 'crew-speaker-name' }, seat?.name ?? '—'),
    h('span', { className: 'crew-speaker-station' }, seat?.title ?? ''),
    h('span', { className: 'crew-speaker-time' }, timeOf(ts)))
}

function ActivityLine({ message }) {
  return h('div', { className: 'crew-activity', 'data-ok': message.meta?.ok !== false },
    h('span', { className: 'crew-activity-dot' }),
    h('span', { className: 'crew-activity-text' }, message.text),
    h('span', { className: 'crew-activity-time' }, timeOf(message.ts)))
}

function ChatLine({ message, seat }) {
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotAvatar, { bot: seat, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts }),
      h('div', { className: 'bt-bubble' }, h(Markdown, { text: message.text }))))
}

function EvidenceCard({ message, seat }) {
  const meta = message.meta ?? {}
  const ref = meta.evidenceRef
  const turn = meta.kind === 'turn'
  const command = meta.kind === 'command'
  const manual = meta.kind === 'manual'
  const passed = meta.exit === 0
  const source = meta.simulated === true ? '模拟执行 · 未真实运行' : meta.sample === true ? '样例数据' : turn ? '真实回合 · 已落盘' : manual ? '产物就绪 · 等你验收' : '命令已真实执行'
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotAvatar, { bot: seat, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts }),
      h('div', { className: 'crew-card', 'data-demo': meta.simulated === true || meta.sample === true },
        h('div', { className: 'crew-card-head' },
          command ? '证据 · 验收命令' : turn ? '证据 · 真实回合' : manual ? '证据 · 产物就绪' : `证据 · 阶段 ${(meta.stage ?? 0) + 1}`,
          command
            ? h('span', { className: 'crew-verdict', 'data-pass': passed, 'data-reject': !passed }, passed ? 'exit 0' : `exit ${meta.exit ?? '无'}`)
            : turn ? h('span', { className: 'crew-verdict', 'data-pass': true }, '基座') : null),
        h('div', { className: 'crew-card-body' },
          turn
            ? h('div', { className: 'crew-receipt' },
              h('code', null, meta.summary ?? '回合'),
              h('span', null, `${((meta.durationMs ?? 0) / 1000).toFixed(1)}s`))
            : manual
              ? h('div', { className: 'crew-receipt' },
                h('code', null, `${meta.workers?.length ?? 1} 席产物已就绪`),
                h('span', null, '等你验收'))
              : h('div', { className: 'crew-receipt' },
                h('code', null, meta.command),
                h('span', null, `exit ${meta.exit}`)),
          meta.files?.length ? h('div', { className: 'crew-receipt-files' }, meta.files.join(' · ')) : null,
          turn && meta.artifacts?.length
            ? h('details', { className: 'crew-fold' }, h('summary', null, '产物'),
              meta.artifacts.map(artifact => h('div', { key: artifact.path },
                h('code', null, `${artifact.path.split('/').at(-1)} · ${artifact.sha256.slice(0, 12)} · ${artifact.bytes}B`),
                h('pre', { className: 'crew-code' }, artifact.content))))
            : null,
          meta.output
            ? h('details', { className: 'crew-fold' }, h('summary', null, turn ? '原始回合数据' : '输出'), h('pre', { className: 'crew-code' }, meta.output))
            : null,
          meta.diff
            ? h('details', { className: 'crew-fold' }, h('summary', null, '改动'), h('pre', { className: 'crew-code' }, meta.diff))
            : null,
          meta.simulated === true ? null : message.text ? h(Markdown, { text: message.text, variant: 'compact' }) : null),
        h('div', { className: 'crew-card-foot' },
          h('span', null, source),
          ref ? h('a', {
            className: 'crew-ref',
            href: `/api/rooms/${message.roomId}/evidence/${message.id}`,
            target: '_blank',
            rel: 'noreferrer',
          }, ref) : null))))
}

function VerdictCard({ message, seat, stage, room, onAccept }) {
  const meta = message.meta ?? {}
  const pass = meta.pass === true
  const active = stage?.state === 'active'
  const independent = room.independence === 'vendor'
  const foot = meta.simulated === true
    ? `模拟复核 · ${independenceOf(room)}`
    : independent
      ? '验收只读复核 · 与执行不同厂商'
      : `验收只读复核 · ${independenceOf(room)}`
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotAvatar, { bot: seat, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts }),
      h('div', { className: 'crew-card', 'data-demo': meta.simulated === true },
        h('div', { className: 'crew-card-head' },
          `验收 · 阶段 ${(meta.stage ?? 0) + 1}`,
          h('span', { className: 'crew-verdict', 'data-pass': pass, 'data-reject': !pass }, pass ? 'PASS' : 'REJECT')),
        h('div', { className: 'crew-card-body' },
          meta.command ? h('div', { className: 'crew-kv' }, h('span', null, '命令'), h('code', null, meta.command)) : null,
          meta.exit !== undefined ? h('div', { className: 'crew-kv' }, h('span', null, '退出码'), h('code', null, String(meta.exit))) : null,
          message.text ? h(Markdown, { text: message.text, variant: 'compact' }) : null),
        h('div', { className: 'crew-card-foot' },
          foot,
          pass && active && stage?.kind === 'deliverable'
            ? h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: room.state !== 'active',
              onClick: () => onAccept(meta.stage),
            }, room.state === 'paused' ? '已暂停 · 继续后才能验收' : '接受这一阶段')
            : null,
          !active && stage?.state === 'passed' ? h('span', { className: 'crew-accepted' }, '已由你验收') : null))))
}

function ConclusionCard({ message }) {
  const meta = message.meta ?? {}
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat: { name: '结论', title: '' }, ts: message.ts }),
      h('div', { className: 'crew-card crew-conclusion' },
        h('div', { className: 'crew-card-head' }, `结论 · ${meta.stages ?? '—'} 个阶段`, h('span', { className: 'crew-verdict', 'data-pass': true }, '完成')),
        h('div', { className: 'crew-card-body' },
          h(Markdown, { text: message.text, variant: 'compact' }),
          meta.commands?.length
            ? h('div', { className: 'crew-kv' }, h('span', null, '验收'), h('code', null, meta.commands.join(' · ')))
            : null))))
}

function ImportButton({ className, onFile, children }) {
  const input = useRef(null)
  return h(Fragment, null,
    h('input', {
      ref: input,
      type: 'file',
      accept: '.json,application/json',
      style: { display: 'none' },
      onChange: event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file !== undefined) void onFile(file)
      },
    }),
    h('button', { type: 'button', className, onClick: () => input.current?.click() }, children ?? '打开交接记录'))
}

function Sidebar({ state, onSelect, onNew, onImport }) {
  const { rooms, dispatch, seats, activeId } = state
  const roster = useMemo(() => {
    const byId = Object.fromEntries(seats.map(seat => [seat.id, seat]))
    for (const room of rooms) for (const seat of room.seatSpecs ?? []) byId[seat.id] = seat
    return {
      byId,
      roomsById: Object.fromEntries(rooms.map(room => [room.id, room])),
      exchangeTurns: {},
      questions: {},
    }
  }, [seats, rooms])
  const pending = dispatch?.requests?.filter(request => request.state === 'suggested').length ?? 0
  const waiting = rooms.filter(room => room.needsYou).length

  return h('aside', { className: 'dsb-side' },
    h('div', { className: 'crew-side-brand' }, h(BotMark, { size: 22, live: false }), 'Lodge'),
    state.runtime?.ok === false
      ? h('div', { className: 'crew-error', style: { margin: '0 6px 10px' } }, `基座未连接：${state.runtime.error}`)
      : null,
    h('div', { className: 'bt-side' },
      h('div', { className: 'bt-list' },
        h('button', {
          type: 'button',
          className: 'bt-row crew-desk-row',
          'aria-current': activeId === 'dispatch' ? 'page' : undefined,
          onClick: () => onSelect('dispatch'),
        },
        h('span', { className: 'crew-desk-mark' }, '调'),
        h('span', { className: 'bt-row-body' },
          h('span', { className: 'bt-row-name' },
            h('span', { className: 'bt-row-title' }, '调度台'),
            pending > 0 ? h('span', { className: 'crew-count' }, String(pending)) : null),
          pending > 0 ? h('span', { className: 'bt-row-preview' }, '待你确认') : null)),
        h('div', { className: 'crew-section' },
          h('span', null, '房间'),
          h('span', { className: 'crew-section-tools' },
            waiting > 0 ? h('span', { className: 'crew-needs-count' }, `${waiting} 个等你`) : null,
            h(ImportButton, { className: 'crew-new', onFile: onImport }, '打开'),
            h('button', { type: 'button', className: 'crew-new', onClick: onNew }, '＋ 新建'))),
        rooms.map(room => h(RoomRow, {
          key: room.id,
          room,
          roster,
          active: activeId === room.id,
          onSelect: () => onSelect(room.id),
        })))),
    state.budget?.globalBudgetMicroUsd > 0
      ? h('div', { className: 'crew-me' },
        h('span', { className: 'crew-me-badge' }, '预'),
        h('span', { className: 'crew-me-body' },
          h('b', null, '全局预算'),
          h('small', null, `${money(state.budget.globalSpentMicroUsd)} / ${money(state.budget.globalBudgetMicroUsd)}`)))
      : null,
    h('div', { className: 'crew-me' },
      h('span', { className: 'crew-me-badge' }, '你'),
      h('span', { className: 'crew-me-body' }, h('b', null, '你'))))
}

function RoomRow({ room, roster, active, onSelect }) {
  const needs = room.needsYou
  const preview = needs
    ? needs.label
    : room.imported === true ? '交接记录 · 只读'
      : room.live === true ? '实时 · 基座房间' : room.state === 'complete' ? '已完成' : '进行中'
  return h('button', {
    type: 'button',
    className: 'bt-row',
    'aria-current': active ? 'page' : undefined,
    onClick: onSelect,
  },
  h(RoomAvatar, { room: { ...room, members: room.members ?? [] }, roster, size: 36 }),
  h('span', { className: 'bt-row-body' },
    h('span', { className: 'bt-row-name' },
      h('span', { className: 'bt-row-title' }, room.name),
      needs ? h('span', { className: 'crew-needs-dot', 'data-kind': needs.kind, title: needs.label }) : null),
    h('span', { className: 'bt-row-preview', 'data-needs': needs?.kind }, preview)))
}

function Advanced({ room, seats, store, engines = [] }) {
  const cost = room.usage?.costMicroUsd ?? 0
  const budget = room.usage?.budgetMicroUsd ?? 0
  const percent = budget === 0 ? 0 : Math.min(100, Math.round((cost / budget) * 100))
  const availableEngines = engines.filter(item => item.available)
  const [budgetDraft, setBudgetDraft] = useState(String(budget / 1_000_000))
  useEffect(() => {
    setBudgetDraft(String(budget / 1_000_000))
  }, [room.id, budget])
  const saveBudget = () => {
    const value = Number(budgetDraft)
    if (!Number.isFinite(value) || value < 0) return
    void store.setBudget(value)
  }
  return h('div', { className: 'crew-adv' },
    h('div', { className: 'crew-adv-meta' },
      h('span', null, `房间策略：${room.independencePolicy ?? '未标注'}`),
      h('span', null, `可用引擎：${availableEngines.length === 0 ? '无' : availableEngines.map(item => `${item.name}${item.models?.default ? `（${item.models.default}）` : ''}`).join('、')}`),
      ...Object.entries(room.engineFallbacks ?? {}).map(([seat, item]) => (
        h('span', { key: `engine-${seat}` }, `${seat}：${item.requested} → ${item.actual}（${item.reason}）`)
      )),
      h('span', null, '预算按基座上报用量估算，不是账单'),
      room.repoPath ? h('span', null, `仓库：${room.repoPath}`) : null,
      room.sourceRepo ? h('span', null, `源仓库：${room.sourceRepo}`) : null,
      ...(room.seatSpecs ?? []).map(seat => (
        room.worktrees?.[seat.id]
          ? h('span', { key: seat.id }, `${seat.name} 工作区：${room.worktrees[seat.id]}${room.prunedSeats?.includes(seat.id) ? '（已清理）' : ''}`)
          : null
      )),
      room.branch ? h('span', null, `房间分支：${room.branch}`) : null,
      room.workers?.length > 1 ? h('span', null, `并行执行：${room.workers.length} 个执行 worktree，合并后复核`) : null,
      h('span', null, `已完成回合：${room.usage?.turns ?? 0}`),
      h('span', null, `轮次：${room.round ?? 0}`),
      h('span', null, `连续无产出：${room.noProgress ?? 0}`),
      h('span', null, `游标：${(room.seatSpecs ?? []).map(seat => `${seat.name} ${room.seatCursors?.[seat.id] ?? 0}`).join(' · ')} / ${room.messages?.at(-1)?.seq ?? 0}`)),
    h('div', { className: 'crew-budget' },
      h('span', null, '预算'),
      h('div', { className: 'crew-bar' }, h('i', { style: { width: `${percent}%` } })),
      h('b', null, budget === 0 ? `${money(cost)} / 不限` : `${money(cost)} / ${money(budget)}`)),
    room.imported === true
      ? null
      : h('div', { className: 'crew-budget-edit' },
        h('span', null, '房间预算（美元，0 为不限）'),
        h('input', {
          type: 'number',
          min: 0,
          step: 1,
          value: budgetDraft,
          onChange: event => setBudgetDraft(event.target.value),
        }),
        h('button', { type: 'button', className: 'crew-choice', onClick: saveBudget }, '保存')),
    h('div', { className: 'crew-budget-edit' },
      room.imported === true
        ? h('span', null, '这是导入的只读交接记录；要继续工作，请对照 BRIEF 与证据新建房间。')
        : h('button', { type: 'button', className: 'crew-choice', onClick: () => void store.exportHandoff() }, '导出交接包'),
      room.imported === true
        ? null
        : h('span', null, '包含 BRIEF / GOAL / CONCLUSION / transcript / events / evidence；本机绝对路径已替换为占位符。')),
    h('table', { className: 'crew-adv-table' },
      h('thead', null, h('tr', null,
        ['席位', '引擎', '权限', '发言预算'].map(label => h('th', { key: label }, label)))),
      h('tbody', null, seats.map(seat => h('tr', { key: seat.id },
        h('td', null, seat.name),
        h('td', null, h('code', null, room.engines?.[seat.id] ?? seat.engine)),
        h('td', null, seat.permissions?.write ? 'worktree 写' : seat.permissions?.exec ? '只读 + 执行' : '只读'),
        h('td', null, `${seat.speakBudget} 次/回合`))))))
}

function StageAction({ room, stage, index, onAccept, onAnswer }) {
  const blocked = Boolean(room.openQuestion)
  const locked = room.state !== 'active'
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const canConfirm = !locked && (!blocked || draft.trim() !== '')

  const confirm = async () => {
    if (!canConfirm || busy) return
    setBusy(true)
    if (blocked) await onAnswer(index, draft.trim())
    else await onAccept(index)
    setBusy(false)
  }

  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h('div', { className: 'crew-card crew-human-gate' },
        h('div', { className: 'crew-card-head' },
          `阶段 ${index + 1}`,
          h('span', { className: 'crew-verdict', 'data-pending': true }, blocked ? '等你回答' : '等你拍板')),
        h('div', { className: 'crew-card-body' },
          h('div', { className: 'crew-gate-title' }, stage.title),
          blocked ? h('p', { className: 'crew-gate-question' }, room.openQuestion) : null,
          blocked
            ? h('textarea', {
              className: 'crew-gate-input',
              rows: 2,
              value: draft,
              placeholder: '你的决定…',
              onChange: event => setDraft(event.target.value),
              onKeyDown: event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void confirm()
                }
              },
            })
            : null),
        h('div', { className: 'crew-card-foot' },
          h('button', {
            type: 'button',
            className: 'crew-accept',
            disabled: !canConfirm || busy,
            onClick: () => void confirm(),
          }, blocked ? '回答并确认' : '确认这一阶段')))))
}

function DemoStep({ stage, index, onSimulate }) {
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h('div', { className: 'crew-card' },
        h('div', { className: 'crew-card-head' },
          `阶段 ${index + 1}`,
          h('span', { className: 'crew-verdict', 'data-pending': true }, '演示')),
        h('div', { className: 'crew-card-body' },
          h('p', { className: 'crew-muted' },
            `\`${stage.acceptance ?? 'npm test'}\` 还没真实跑过，这一步用模拟数据走完流程。`)),
        h('div', { className: 'crew-card-foot' },
          h('button', { type: 'button', className: 'crew-accept', onClick: onSimulate }, '模拟执行并复核')))))
}

function LiveGate({ room, stage, index, onSetAcceptance, onVerify, onAccept }) {
  const [draft, setDraft] = useState(stage.acceptance ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setDraft(stage.acceptance ?? '') }, [stage.acceptance])
  const evidence = [...room.messages].reverse().find(message => (
    message.kind === 'evidence' && message.meta?.kind === 'command' && message.meta?.stage === index
  ))
  const exit = evidence?.meta?.exit
  const hasVerifier = (room.verifiers?.length ?? 0) > 0
  const locked = room.state !== 'active'
  const changed = draft.trim() !== (stage.acceptance ?? '')

  const save = async () => {
    if (busy || locked) return
    setBusy(true)
    await onSetAcceptance(index, draft.trim())
    setBusy(false)
  }
  const verify = async () => {
    if (busy || locked) return
    setBusy(true)
    await onVerify(index)
    setBusy(false)
  }

  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h('div', { className: 'crew-card crew-human-gate' },
        h('div', { className: 'crew-card-head' },
          `阶段 ${index + 1} · 真实验收`,
          h('span', { className: 'crew-verdict', 'data-pending': true }, exit === 0 ? '等待复核' : '等待命令')),
        h('div', { className: 'crew-card-body' },
          h('div', { className: 'crew-gate-title' }, stage.title),
          h('p', { className: 'crew-gate-question' },
            room.repoPath
              ? '验收命令在房间仓库里真实执行；退出码、输出与 diff 会落成证据。'
              : '房间没有固定工作目录，验收命令不会执行。先给基座群设置工作目录。'),
          h('textarea', {
            className: 'crew-gate-input',
            rows: 2,
            value: draft,
            placeholder: '例如：npm test',
            disabled: locked,
            onChange: event => setDraft(event.target.value),
          }),
          evidence
            ? h('div', { className: 'crew-receipt' },
              h('code', null, evidence.meta.command),
              h('span', null, `exit ${exit ?? '无'}`),
              h('span', null, `${((evidence.meta.durationMs ?? 0) / 1000).toFixed(1)}s`))
            : null,
          h('p', { className: 'crew-dialog-note' }, `${hasVerifier ? '复核由验收席位执行' : '没有独立验收席位'} · ${independenceOf(room)}`)),
        h('div', { className: 'crew-card-foot' },
          h('button', {
            type: 'button',
            className: 'crew-ghost',
            disabled: busy || locked || !changed,
            onClick: () => void save(),
          }, '保存命令'),
          evidence && exit === 0 && hasVerifier
            ? h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: busy || locked,
              onClick: () => void verify(),
            }, busy ? '等待复核…' : '请求独立复核')
            : null,
          evidence && exit === 0 && !hasVerifier
            ? h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: locked,
              onClick: () => onAccept(index),
            }, '接受这一阶段')
            : null,
          evidence && exit !== 0
            ? h('span', { className: 'crew-muted' }, '命令未通过：返工后重跑')
            : null))))
}

function Timeline({ room, seats, onAccept, onAnswer, onSimulate, onSetAcceptance, onVerify }) {
  const byId = useMemo(() => Object.fromEntries(seats.map(seat => [seat.id, seat])), [seats])
  const activeIndex = room.stages.findIndex(stage => stage.state === 'active')
  const activeStage = room.stages[activeIndex]
  const hasPass = activeIndex >= 0 && room.messages.some(message => (
    message.kind === 'verdict' && message.meta?.pass === true && message.meta?.stage === activeIndex
  ))
  const manualReady = activeStage?.manual === true && room.messages.some(message => (
    message.kind === 'evidence' && message.meta?.kind === 'manual' && (message.meta?.stage ?? 0) === activeIndex
  ))

  return [
    ...room.messages.map(message => {
      const seat = byId[message.authorId] ?? (message.authorId === 'system' ? { name: '运行时', title: '验收' } : undefined)
      if (message.kind === 'system') return h('div', { key: message.id, className: 'crew-system' }, message.text)
      if (message.kind === 'activity') return h(ActivityLine, { key: message.id, message })
      if (message.kind === 'evidence') return h(EvidenceCard, { key: message.id, message, seat })
      if (message.kind === 'conclusion') return h(ConclusionCard, { key: message.id, message })
      if (message.kind === 'verdict') {
        return h(VerdictCard, {
          key: message.id,
          message,
          seat,
          room,
          stage: room.stages[message.meta?.stage ?? 0],
          onAccept,
        })
      }
      if (message.authorId === 'you') {
        return h('div', { key: message.id, className: 'crew-human' },
          h('div', { className: 'bt-ububble' }, h(Markdown, { text: message.text, variant: 'compact' })))
      }
      return h(ChatLine, { key: message.id, message, seat })
    }),
    activeStage?.kind === 'decision' && (activeStage.manual !== true || manualReady)
      ? h(StageAction, { key: 'gate', room, stage: activeStage, index: activeIndex, onAccept, onAnswer })
      : null,
    activeStage?.kind === 'deliverable' && room.live === true && !hasPass
      ? h(LiveGate, { key: 'live-gate', room, stage: activeStage, index: activeIndex, onSetAcceptance, onVerify, onAccept })
      : null,
    activeStage?.kind === 'deliverable' && room.demo === true && !hasPass
      ? h(DemoStep, { key: 'demo', stage: activeStage, index: activeIndex, onSimulate })
      : null,
  ].filter(Boolean)
}

function DispatchCard({ request, onConfirm, onDecline, onOpen }) {
  const suggestion = request.suggestion
  return h('div', { className: 'crew-req' },
    h('div', { className: 'crew-req-head' },
      h('span', { className: 'crew-req-text' }, request.text),
      h('span', { className: 'crew-req-time' }, timeOf(request.at))),
    h('div', { className: 'crew-req-body' },
      h('div', { className: 'crew-sug' },
        h('span', null, '建议交给 '),
        h('button', { type: 'button', className: 'crew-link', onClick: onOpen }, suggestion.roomName),
        h('span', null, ` · ${suggestion.seatName}`)),
      h('p', { className: 'crew-req-reason' }, suggestion.reason)),
    h('div', { className: 'crew-req-foot' },
      h('button', { type: 'button', className: 'crew-ghost', onClick: onDecline }, '驳回'),
      h('button', { type: 'button', className: 'crew-accept', onClick: onConfirm }, '确认')))
}

function DigestItem({ item, onOpen }) {
  const stateText = item.state === 'complete'
    ? '已完成'
    : item.stage
      ? `阶段 ${item.stage.index}/${item.stage.total} · ${item.stage.title}`
      : '待总结'
  return h('button', { type: 'button', className: 'crew-digest-item', onClick: onOpen },
    h('span', { className: 'crew-digest-main' },
      h('span', { className: 'crew-digest-room' }, item.roomName),
      h('span', { className: 'crew-digest-state', 'data-done': item.state === 'complete' }, stateText)),
    h('span', { className: 'crew-digest-evidence' },
      item.evidence ? `${item.evidence.command} · exit ${item.evidence.exit}` : '暂无证据'),
    item.needsYou
      ? h('span', { className: 'crew-digest-needs', 'data-kind': item.needsYou.kind },
        item.needsYou.kind === 'question' && item.openQuestion
          ? `未决：${item.openQuestion}`
          : item.needsYou.label)
      : null)
}

function DispatchView({ state, store }) {
  const { dispatch } = state
  if (dispatch === null) return null
  const pending = dispatch.requests.filter(request => request.state === 'suggested')
  const decided = dispatch.requests.filter(request => request.state !== 'suggested')

  return h('main', { className: 'dsb-main' },
    h('header', { className: 'crew-head crew-desk-head' },
      h('div', { className: 'crew-title' },
        h('h1', null, '调度台'),
        h('span', { className: 'crew-badge' }, '只建议 · 你确认'))),
    h('div', { className: 'dsb-scroll crew-scroll' },
      h('div', { className: 'crew-flow' },
        h('div', { className: 'crew-section-title' }, `待你确认 · ${pending.length}`),
        pending.length === 0
          ? h('p', { className: 'crew-muted' }, '没有新的请求。')
          : pending.map(request => h(DispatchCard, {
            key: request.id,
            request,
            onConfirm: () => void store.dispatchConfirm(request.id),
            onDecline: () => void store.dispatchDecline(request.id),
            onOpen: () => store.select(request.suggestion.roomId),
          })),
        h('div', { className: 'crew-section-title' }, '已处理'),
        decided.length === 0
          ? h('p', { className: 'crew-muted' }, '还没有处理过的请求。')
          : decided.map(request => h('div', { key: request.id, className: 'crew-done-row' },
            h('span', { className: 'crew-done-text' }, request.text),
            h('span', { className: 'crew-done-target' }, request.suggestion.roomName),
            h('span', { className: 'crew-done-state', 'data-declined': request.state === 'declined' },
              request.state === 'confirmed' ? '已派' : '已驳回'))),
        h('div', { className: 'crew-section-title' }, '汇总'),
        dispatch.digest.map(item => h(DigestItem, {
          key: item.roomId,
          item,
          onOpen: () => store.select(item.roomId),
        })))),
    h('div', { className: 'dsb-composer' },
      h(Composer, {
        placeholder: '说说你想做什么，我建议交给哪个群…',
        disabled: state.phase === 'loading',
        onSend: text => store.dispatchAsk(text),
      })))
}

function Composer({ placeholder, disabled, onSend }) {
  const [draft, setDraft] = useState('')

  const send = () => {
    const text = draft.trim()
    if (text === '' || disabled) return
    setDraft('')
    void onSend(text)
  }

  return h('div', { className: 'crew-composer' },
    h('textarea', {
      className: 'crew-input',
      rows: 1,
      value: draft,
      placeholder,
      disabled,
      onChange: event => setDraft(event.target.value),
      onKeyDown: event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          send()
        }
      },
    }),
    h('button', { type: 'button', className: 'crew-send', 'aria-label': '发送', disabled: disabled || draft.trim() === '', onClick: send },
      h(ArrowUpIcon)))
}

function RoomView({ state, room, store }) {
  const [advanced, setAdvanced] = useState(false)
  const scroll = useRef(null)
  const lastId = room.messages.at(-1)?.id

  useEffect(() => {
    const node = scroll.current
    if (node) node.scrollTop = node.scrollHeight
  }, [lastId])

  const locked = room.state === 'paused' || room.state === 'stopped' || room.imported === true
  const seats = useMemo(() => {
    if (Array.isArray(room.seatSpecs) && room.seatSpecs.length > 0) return room.seatSpecs
    const ids = room.members ?? []
    return ids.length === 0 ? state.seats : state.seats.filter(seat => ids.includes(seat.id))
  }, [room.seatSpecs, room.members, state.seats])

  return h('main', { className: 'dsb-main' },
    h(GoalIsland, {
      room,
      seats,
      advanced,
      onToggleAdvanced: () => setAdvanced(value => !value),
      store,
    }),
    advanced ? h(Advanced, { room, seats, store, engines: state.engines }) : null,
    h('div', { ref: scroll, className: 'dsb-scroll crew-scroll' },
      h('div', { className: 'crew-flow' }, h(Timeline, {
        room,
        seats,
        onAccept: stage => void store.accept(stage),
        onAnswer: (stage, text) => void store.answer(stage, text),
        onSimulate: () => void store.simulate(),
        onSetAcceptance: (stage, command) => void store.setAcceptance(stage, command),
        onVerify: stage => void store.verify(stage),
      })),
      state.error ? h('div', { className: 'crew-error' }, state.error) : null),
    h('div', { className: 'dsb-composer' },
      h(Composer, {
        placeholder: room.imported === true
          ? '交接记录 · 只读'
          : room.state === 'complete'
          ? '这次交付已结束；说话可以开新一轮…'
          : room.state === 'paused'
            ? '已暂停 · 继续后才能派新活'
            : room.state === 'stopped'
              ? '已停止 · 不会再派新活'
              : '对房间说话…',
        disabled: state.phase === 'loading' || locked,
        onSend: text => store.send(text),
      })))
}

const INITIAL_SEATS = () => [
  { key: 'lead', role: 'lead', label: '队长', name: '队长', on: true },
  { key: 'worker-1', role: 'worker', label: '执行', name: '执行', on: true, required: true },
  { key: 'verifier', role: 'verifier', label: '验收', name: '验收', on: true },
]
const ROLE_LABEL = { lead: '队长', worker: '执行', verifier: '验收' }

// 队长只给角色与名字；权限仍由服务端按角色派生。
const seatsFromProposal = proposal => {
  const lead = proposal.seats.find(seat => seat.role === 'lead')
  const verifier = proposal.seats.find(seat => seat.role === 'verifier')
  const workers = proposal.seats.filter(seat => seat.role === 'worker')
  return [
    { key: 'lead', role: 'lead', label: '队长', name: lead?.name ?? '队长', on: lead !== undefined },
    ...workers.map((seat, index) => ({
      key: `worker-${index + 1}`,
      role: 'worker',
      label: '执行',
      name: seat.name,
      on: true,
      required: true,
    })),
    { key: 'verifier', role: 'verifier', label: '验收', name: verifier?.name ?? '验收', on: verifier !== undefined },
  ]
}

function NewRoomDialog({ open, onClose, onCreate, onRecommend, templates = [] }) {
  const choices = templates.length > 0 ? templates : [{ id: 'delivery-triad', name: '交付三人组', seats: 3 }, { id: 'solo', name: '单人', seats: 1 }]
  const templateChoices = [...choices, { id: 'custom', name: '自定义', seats: null }]
  const [step, setStep] = useState(0)
  const [templateId, setTemplateId] = useState(choices[0]?.id ?? 'delivery-triad')
  const [seats, setSeats] = useState(INITIAL_SEATS)
  const [goal, setGoal] = useState('')
  const [verify, setVerify] = useState('test')
  const [acceptance, setAcceptance] = useState('npm test')
  const [repoPath, setRepoPath] = useState('')
  const [proposal, setProposal] = useState(null)
  const [answers, setAnswers] = useState([])
  const [manual, setManual] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (!open) return null

  const custom = templateId === 'custom'
  const activeSeats = seats.filter(seat => seat.on)
  const hasVerifier = custom
    ? activeSeats.some(seat => seat.role === 'verifier')
    : templateId !== 'solo'
  const toggleSeat = key => setSeats(list => list.map(seat => (
    seat.key === key && seat.role !== 'worker' ? { ...seat, on: !seat.on } : seat
  )))
  const renameSeat = (key, name) => setSeats(list => list.map(seat => (
    seat.key === key ? { ...seat, name } : seat
  )))
  const addWorker = () => setSeats(list => {
    const count = list.filter(seat => seat.role === 'worker').length + 1
    return [...list, {
      key: `worker-${Math.random().toString(36).slice(2, 8)}`,
      role: 'worker',
      label: '执行',
      name: `执行 ${count}`,
      on: true,
      required: true,
    }]
  })
  const removeWorker = key => setSeats(list => (
    list.filter(seat => seat.role === 'worker' && seat.on).length <= 1
      ? list
      : list.filter(seat => seat.key !== key)
  ))
  const workerCount = activeSeats.filter(seat => seat.role === 'worker').length
  const rosterName = activeSeats.map(seat => seat.name.trim() || seat.label).join('、')

  const useProposal = proposal !== null && !manual

  const recommend = async () => {
    if (goal.trim() === '' || recommending) return
    setRecommending(true)
    setError(null)
    const result = await onRecommend(goal.trim(), repoPath.trim())
    setRecommending(false)
    if (result?.ok !== true) {
      setError(result?.error ?? '队长没有给出建议')
      setManual(true)
      setTemplateId('custom')
      setSeats(INITIAL_SEATS)
      setStep(1)
      return
    }
    setProposal(result.proposal)
    setAnswers(result.proposal.questions.map(question => question.recommendation))
    setManual(false)
    setTemplateId('custom')
    setSeats(seatsFromProposal(result.proposal))
    setVerify(result.proposal.verify)
    setAcceptance(result.proposal.acceptance ?? '')
    setStep(1)
  }

  const chooseManual = () => {
    if (proposal !== null) setSeats(seatsFromProposal(proposal))
    setManual(true)
    setTemplateId('custom')
    setStep(1)
  }

  const start = async () => {
    setBusy(true)
    setError(null)
    const roster = useProposal
      ? proposal.seats.map(({ role, name }) => ({ role, name }))
      : activeSeats.map(seat => ({ role: seat.role, name: seat.name.trim() || seat.label }))
    const result = await onCreate(goal.trim(), {
      verify,
      acceptance: acceptance.trim(),
      repoPath: repoPath.trim(),
      ...(useProposal || custom ? { seats: roster } : { templateId }),
      ...(useProposal ? {
        plan: {
          done: proposal.done,
          why: proposal.why,
          answers: proposal.questions.map((question, index) => ({
            question: question.text,
            answer: answers[index] ?? question.recommendation,
          })),
        },
      } : {}),
    })
    setBusy(false)
    if (result?.ok === true) {
      setGoal('')
      setStep(0)
      setProposal(null)
      setAnswers([])
      setManual(false)
      setError(null)
      onClose()
    } else {
      setError(result?.error ?? '建房失败')
    }
  }

  const verification = [
    h('div', { key: 'verify', className: 'crew-q' },
      h('b', null, '完成后怎么验证？'),
      h('div', { className: 'crew-choices' },
        [['test', '跑一条命令（推荐）'], ['manual', '我自己看一眼']].map(([id, label]) => h('button', {
          key: id,
          type: 'button',
          className: 'crew-choice',
          'data-on': verify === id,
          onClick: () => setVerify(id),
        }, label)))),
    verify === 'test'
      ? h('div', { key: 'acceptance', className: 'crew-q' },
        h('b', null, '验收命令'),
        h('input', {
          className: 'crew-goal-input',
          type: 'text',
          value: acceptance,
          placeholder: '例如：npm test',
          onChange: event => setAcceptance(event.target.value),
        }))
      : null,
  ]

  const manualBody = h(Fragment, null,
    h('div', { className: 'crew-q' },
      h('b', null, '编制'),
      h('div', { className: 'crew-choices' },
        templateChoices.map(template => h('button', {
          key: template.id,
          type: 'button',
          className: 'crew-choice',
          'data-on': templateId === template.id,
          onClick: () => setTemplateId(template.id),
        }, template.seats === null ? `${template.name}（按需）` : `${template.name}（${template.seats} 席）`)))),
    custom
      ? h('div', { className: 'crew-q' },
        h('b', null, '角色（执行至少一个，可并行）'),
        h('div', { className: 'crew-choices' },
          seats.filter(seat => seat.role !== 'worker').map(seat => h('button', {
            key: seat.key,
            type: 'button',
            className: 'crew-choice',
            'data-on': seat.on,
            onClick: () => toggleSeat(seat.key),
          }, seat.label)),
          h('button', {
            type: 'button',
            className: 'crew-choice',
            onClick: addWorker,
          }, '＋ 添加执行')),
        h('b', null, '席位名字'),
        seats.filter(seat => seat.on).map(seat => h('div', { key: seat.key, className: 'crew-seat-line' },
          h('input', {
            className: 'crew-goal-input',
            type: 'text',
            value: seat.name,
            placeholder: seat.label,
            onChange: event => renameSeat(seat.key, event.target.value),
          }),
          seat.role === 'worker' && workerCount > 1
            ? h('button', {
              type: 'button',
              className: 'crew-choice',
              onClick: () => removeWorker(seat.key),
            }, '移除')
            : null)))
      : null)

  const proposalBody = useProposal
    ? h('div', { className: 'crew-q' },
      h('b', null, '队长的开工卡'),
      h('p', { className: 'crew-dialog-lead' },
        `${proposal.seats.length} 席${proposal.why === '' ? '' : ` · ${proposal.why}`}`),
      h('b', null, '做完的样子'),
      h('ul', { className: 'crew-brief' },
        proposal.done.map((text, index) => h('li', { key: `done-${index}` }, text))),
      proposal.questions.length > 0
        ? h(Fragment, null,
          h('b', null, '要你拍板'),
          proposal.questions.map((question, index) => h('div', { key: `q-${index}`, className: 'crew-q' },
            h('span', null, `${index + 1}. ${question.text}`),
            h('input', {
              className: 'crew-goal-input',
              type: 'text',
              value: answers[index] ?? '',
              placeholder: question.recommendation,
              onChange: event => setAnswers(list => list.map((item, at) => at === index ? event.target.value : item)),
            }))))
        : h('p', { className: 'crew-island-soft' }, '没有需要你额外拍板的问题。'),
      h('b', null, '编制'),
      h('ul', { className: 'crew-brief' },
        proposal.seats.map((seat, index) => h('li', { key: `${seat.role}-${index}` },
          `${ROLE_LABEL[seat.role]}${seat.name === ROLE_LABEL[seat.role] ? '' : `「${seat.name}」`}${seat.reason === '' ? '' : ` · ${seat.reason}`}`))),
      proposal.note === '' ? null : h('p', { className: 'crew-dialog-note' }, proposal.note),
      verify === 'manual'
        ? h('p', { className: 'crew-dialog-note' },
          hasVerifier
            ? '人工验收模式不需要验收席位；要独立复核就补一条验收命令。'
            : '验收方式：你自己看产物；这一步没有命令证据。')
        : null)
    : null

  const body = step === 0
    ? h('div', { className: 'crew-dialog-body' },
      h('p', { className: 'crew-dialog-lead' }, '一句话说目标，可以很糙。'),
      h('textarea', {
        className: 'crew-goal-input',
        rows: 3,
        autoFocus: true,
        value: goal,
        placeholder: '例如：给 CLI 加个 verbose',
        onChange: event => setGoal(event.target.value),
      }),
      h('div', { className: 'crew-q' },
        h('b', null, '工作目录（可选）'),
        h('input', {
          className: 'crew-goal-input',
          type: 'text',
          value: repoPath,
          placeholder: '留空则让队长在新建的空仓库里判断',
          onChange: event => setRepoPath(event.target.value),
        })),
      h('p', { className: 'crew-dialog-note' },
        '队长会先看目标和仓库，给你一个编制建议：几个人、什么职责、怎么验收。你只确认或改一下。'))
    : step === 1
      ? h('div', { className: 'crew-dialog-body' },
        useProposal ? proposalBody : manualBody,
        ...verification,
        error ? h('p', { className: 'crew-dialog-note' }, error) : null)
      : h('div', { className: 'crew-dialog-body' },
        h('p', { className: 'crew-dialog-lead' }, '最后一眼：done、仓库、独立性。'),
        h('ul', { className: 'crew-brief' },
          h('li', null, `目标达成：${goal}`),
          h('li', null, custom
            ? `编制：自定义 · ${rosterName}`
            : `编制：${choices.find(item => item.id === templateId)?.name ?? '交付三人组'} · ${choices.find(item => item.id === templateId)?.seats ?? 3} 席`),
          h('li', null, verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：你逐段确认，不跑命令'),
          h('li', null, `仓库：${repoPath || '自动新建（~/CrewWorkspaces）'}`),
          h('li', null, '你不点「接受」，阶段不会算通过')),
        h('p', { className: 'crew-dialog-note' },
          verify === 'manual' && hasVerifier
            ? '人工验收模式不需要验收席位；要独立复核就补一条验收命令。'
            : hasVerifier
              ? '复核由验收席位执行；当前只有一台 CLI，验收卡会标「独立性降级」；第二引擎在 M4 接入。'
              : '这个房间没有独立验收席位：完成后由你凭证据签字。'),
        error ? h('p', { className: 'crew-dialog-note' }, error) : null)

  return h('div', { className: 'crew-overlay', onClick: onClose },
    h('div', { className: 'crew-dialog', onClick: event => event.stopPropagation() },
      h('div', { className: 'crew-dialog-head' },
        h('h2', null, '建队'),
        h('button', { type: 'button', className: 'crew-ghost', onClick: onClose }, '关闭')),
      h('div', { className: 'crew-steps' },
        ['目标', '编制', '确认'].map((label, index) => h('span', {
          key: label,
          className: 'crew-step',
          'data-on': index === step,
        }, `${index + 1} ${label}`))),
      body,
      h('div', { className: 'crew-dialog-foot' },
        step > 0 ? h('button', { type: 'button', className: 'crew-ghost', onClick: () => setStep(step - 1) }, '上一步') : null,
        step === 0
          ? h(Fragment, null,
            h('button', { type: 'button', className: 'crew-ghost', onClick: chooseManual }, '手动选编制'),
            h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: goal.trim() === '' || recommending,
              onClick: () => void recommend(),
            }, recommending ? '队长在看目标…' : '让队长看目标'))
          : step === 1
            ? h(Fragment, null,
              useProposal
                ? h('button', { type: 'button', className: 'crew-ghost', onClick: chooseManual }, '改一下')
                : null,
              useProposal
                ? h('button', {
                  type: 'button',
                  className: 'crew-accept',
                  disabled: busy || (verify === 'manual' && hasVerifier) || (verify === 'test' && acceptance.trim() === ''),
                  onClick: () => void start(),
                }, busy ? '正在建真实房间…' : '按方案开工')
                : h('button', {
                  type: 'button',
                  className: 'crew-accept',
                  disabled: verify === 'test' && acceptance.trim() === '',
                  onClick: () => setStep(2),
                }, '下一步'))
            : h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: busy || (verify === 'manual' && hasVerifier),
              onClick: () => void start(),
            }, busy ? '正在建真实房间…' : '开始'))))
}

export function App() {
  const store = useMemo(createStore, [])
  const state = useStore(store)
  const [dialog, setDialog] = useState(false)

  useEffect(() => {
    store.start()
    return () => store.disconnect()
  }, [store])

  if (state.rooms.length === 0) {
    return h('div', { className: 'crew-onboarding' },
      h('div', { className: 'crew-onboarding-card' },
        h(BotMark, { size: 44 }),
        h('h1', null, 'Lodge'),
        h('p', null, '开间专属任务房，养一支 AI 小队——你下班，它上班。'),
        h('button', {
          type: 'button',
          className: 'crew-accept',
          disabled: state.phase === 'loading' || state.phase === 'error',
          onClick: () => setDialog(true),
        }, '开一个房间'),
        h(ImportButton, { className: 'crew-ghost', onFile: file => store.importHandoffFile(file) }, '打开交接记录'),
        state.runtime?.ok === false ? h('p', { className: 'crew-dialog-note' }, `基座未连接：${state.runtime.error}`) : null,
        state.phase === 'error' ? h('p', { className: 'crew-dialog-note' }, `连接失败：${state.error}`) : null,
        state.error ? h('p', { className: 'crew-dialog-note' }, state.error) : null),
      h(NewRoomDialog, {
        open: dialog,
        onClose: () => setDialog(false),
        templates: state.templates ?? [],
        onCreate: (goal, answers) => store.createRoom(goal, answers),
        onRecommend: (goal, repoPath) => store.recommendRoster(goal, repoPath),
      }))
  }

  const room = state.rooms.find(item => item.id === state.activeId) ?? null
  const isDispatch = state.activeId === 'dispatch' || room === null

  return h('div', { className: 'dsb-frame' },
    h(Sidebar, {
      state,
      onSelect: id => store.select(id),
      onNew: () => setDialog(true),
      onImport: file => store.importHandoffFile(file),
    }),
    isDispatch
      ? h(DispatchView, { state, store })
      : h(RoomView, { state, room, store }),
    h(NewRoomDialog, {
      open: dialog,
      onClose: () => setDialog(false),
      templates: state.templates ?? [],
      onCreate: (goal, answers) => store.createRoom(goal, answers),
      onRecommend: (goal, repoPath) => store.recommendRoster(goal, repoPath),
    }))
}
