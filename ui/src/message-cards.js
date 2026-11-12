import { createElement as h } from 'react'
import { BotAvatar, BotMark } from './marks.js'
import { MarkdownText } from './primitives.js'
import { MD, timeOf, independenceOf } from './view-format.js'

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
            ? h('details', { className: 'crew-fold' },
              h('summary', null, meta.vcs !== undefined && !['git', 'demo'].includes(meta.vcs) ? '文件清单' : '改动'),
              h('pre', { className: 'crew-code' }, meta.diff))
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
      ? '盲审 · 验收只读复核 · 与执行不同厂商'
      : `盲审 · 验收只读复核 · ${independenceOf(room)}`
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

export { Markdown, Speaker, ActivityLine, ChatLine, EvidenceCard, VerdictCard, ConclusionCard }
