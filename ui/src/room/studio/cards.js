import { Fragment, createElement as h } from 'react'
import { BotAvatar, BotMark } from '../../marks.js'
import { Markdown, Speaker } from '../../message-cards.js'
import { splitVerdictText } from './verdict-text.js'

// 工作室专属消息卡：证据、阶段结论、复核结果、交付结论。
// 共享层只提供说话人、正文和活动行，不认这些业务结构。

const OUTPUT_PREVIEW_LINES = 80

// 长输出只给前 N 行；完整内容留在证据文件里，不在聊天里铺开。
function CodeOutput({ text, limit = OUTPUT_PREVIEW_LINES, hint = '打开「证据」看完整输出' }) {
  const lines = String(text ?? '').split('\n')
  const hidden = Math.max(0, lines.length - limit)
  return h(Fragment, null,
    h('pre', { className: 'crew-code' }, hidden === 0 ? lines.join('\n') : lines.slice(0, limit).join('\n')),
    hidden === 0 ? null : h('p', { className: 'crew-code-more' }, `还有 ${hidden} 行未显示 · ${hint}`))
}

function EvidenceCard({ message, seat }) {
  const meta = message.meta ?? {}
  const ref = meta.evidenceRef
  const turn = meta.kind === 'turn'
  const command = meta.kind === 'command'
  const manual = meta.kind === 'manual'
  const passed = meta.exit === 0
  const source = meta.simulated === true ? '模拟执行 · 未真实运行' : meta.sample === true ? '样例数据' : turn ? '真实回合 · 已落盘' : manual ? '产物就绪 · 等你验收' : '命令已真实执行'
  const summary = command
    ? `已交付 · ${meta.command ?? '验收命令'} · exit ${meta.exit ?? '无'}`
    : manual
      ? `${meta.workers?.length ?? 1} 席产物已就绪 · 等你验收`
      : turn
        ? `真实回合 · ${((meta.durationMs ?? 0) / 1000).toFixed(1)}s`
        : `证据 · 阶段 ${(meta.stage ?? 0) + 1}`
  const chip = command ? (passed ? 'exit 0' : `exit ${meta.exit ?? '无'}`) : turn ? '基座' : manual ? '人工' : ''
  return h('div', {
    className: 'studio-result',
    'data-ok': command ? passed : undefined,
    'data-demo': meta.simulated === true || meta.sample === true,
  },
  h('span', { className: 'studio-result-avatar' }, h(BotAvatar, { bot: seat, size: 22, live: false })),
  h('span', { className: 'studio-result-who' }, seat?.name ?? '—'),
  h('span', { className: 'studio-result-what' }, summary),
  chip === '' ? null : h('span', { className: 'studio-result-chip', 'data-pass': command ? passed : undefined }, chip),
  h('details', { className: 'studio-result-more' },
    h('summary', null, '证据'),
    h('div', { className: 'studio-result-body' },
      h('p', { className: 'crew-field-hint' }, source),
      meta.files?.length ? h('div', { className: 'crew-receipt-files' }, meta.files.join(' · ')) : null,
      turn && meta.artifacts?.length
        ? h('details', { className: 'crew-fold' }, h('summary', null, '产物'),
          meta.artifacts.map(artifact => h('div', { key: artifact.path },
            h('code', null, `${artifact.path.split('/').at(-1)} · ${artifact.sha256.slice(0, 12)} · ${artifact.bytes}B`),
            h(CodeOutput, { text: artifact.content, limit: 200, hint: '打开产物文件查看完整内容' }))))
        : null,
      meta.output
        ? h('details', { className: 'crew-fold' }, h('summary', null, turn ? '原始回合数据' : '输出'), h(CodeOutput, { text: meta.output }))
        : null,
      meta.diff
        ? h('details', { className: 'crew-fold' },
          h('summary', null, meta.vcs !== undefined && !['git', 'demo'].includes(meta.vcs) ? '文件清单' : '改动'),
          h(CodeOutput, { text: meta.diff, limit: 300 }))
        : null,
      meta.simulated === true ? null : message.text ? h(Markdown, { text: message.text, variant: 'compact' }) : null)),
  ref ? h('a', {
    className: 'crew-ref',
    href: `/api/rooms/${message.roomId}/evidence/${message.id}`,
    target: '_blank',
    rel: 'noreferrer',
  }, ref) : null)
}

function VerdictCard({ message, seat, stage, room, onAccept, evidence }) {
  const meta = message.meta ?? {}
  const proof = evidence?.meta ?? {}
  const command = typeof proof.command === 'string' ? proof.command : meta.command
  const exit = proof.exit ?? meta.exit
  const files = proof.files ?? proof.changedFiles ?? []
  const pass = meta.pass === true
  const { summary, detail } = splitVerdictText(message.text)
  const output = typeof proof.output === 'string' && proof.output !== '' ? proof.output : ''
  const diff = typeof proof.diff === 'string' && proof.diff !== '' ? proof.diff : ''
  const active = stage?.state === 'active'
  const canAccept = pass && active && stage?.kind === 'deliverable' && typeof onAccept === 'function'
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotAvatar, { bot: seat, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts }),
      h('div', { className: 'crew-card crew-result-card', 'data-demo': meta.simulated === true, 'data-pass': pass },
        h('div', { className: 'crew-card-head' },
          '复核结果卡',
          h('span', { className: 'crew-verdict', 'data-pass': pass, 'data-reject': !pass }, pass ? 'PASS' : 'REJECT')),
        h('div', { className: 'crew-card-body' },
          command ? h('div', { className: 'crew-kv' }, h('span', null, '命令'), h('code', null, command)) : null,
          exit !== undefined && exit !== null ? h('div', { className: 'crew-kv' }, h('span', null, '退出码'), h('code', null, String(exit))) : null,
          summary === '' ? null : h(Markdown, { text: summary, variant: 'compact' }),
          files.length > 0 ? h('div', { className: 'crew-receipt-files' }, files.join(' · ')) : null,
          diff === ''
            ? null
            : h('details', { className: 'crew-fold' }, h('summary', null, '改动'), h(CodeOutput, { text: diff, limit: 300 })),
          // 复核卡先给一句结论；完整理由按需展开，不占主阅读流。
          detail === ''
            ? null
            : h('details', { className: 'crew-fold' },
              h('summary', null, '复核理由'),
              h(Markdown, { text: detail, variant: 'compact' })),
          output === ''
            ? null
            : h('details', { className: 'crew-fold' }, h('summary', null, '原始输出'), h(CodeOutput, { text: output }))),
        canAccept
          ? h('div', { className: 'crew-card-foot' },
            h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: room.state !== 'active',
              onClick: () => onAccept(meta.stage),
            }, room.state === 'paused' ? '已暂停 · 继续后才能验收' : '接受这一阶段'))
          : null)))
}

function MilestoneLine({ message }) {
  const meta = message.meta ?? {}
  const title = typeof meta.title === 'string' && meta.title !== '' ? meta.title : `阶段 ${(meta.stage ?? 0) + 1}`
  return h('div', { className: 'crew-milestone' },
    h('span', { className: 'crew-milestone-check' }, '✓'),
    h('span', { className: 'crew-milestone-title' }, `${title} 已通过`),
    meta.next ? h('span', { className: 'crew-milestone-next' }, `下一步 ${meta.next}`) : null)
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

export {
  EvidenceCard,
  VerdictCard,
  MilestoneLine,
  ConclusionCard,
}
