import { Fragment, createElement as h } from 'react'
import { BotAvatar } from '../../marks.js'
import { Markdown, Speaker } from '../../message-cards.js'
import { shadowFor } from './shadow-model.js'
import { splitVerdictText } from './verdict-text.js'

// 工作室专属消息卡：一张检查结果，或还没复核的证据。
// 共享层只提供说话人、正文和活动行，不认这些业务结构。

const SHADOW_STATUS = {
  agree: '一致',
  disagree: '有分歧',
  neutral: '中性',
  pending: '待定',
  mixed: '多票不一',
  missing: '没有第二意见',
}

const OUTPUT_PREVIEW_LINES = 80

// 长输出只给前 N 行；完整内容留在证据文件里，不在聊天里铺开。
function CodeOutput({ text, limit = OUTPUT_PREVIEW_LINES, hint = '打开「证据」看完整输出' }) {
  const lines = String(text ?? '').split('\n')
  const hidden = Math.max(0, lines.length - limit)
  return h(Fragment, null,
    h('pre', { className: 'crew-code' }, hidden === 0 ? lines.join('\n') : lines.slice(0, limit).join('\n')),
    hidden === 0 ? null : h('p', { className: 'crew-code-more' }, `还有 ${hidden} 行未显示 · ${hint}`))
}

function EvidenceCard({ message, member }) {
  const meta = message.meta ?? {}
  const ref = meta.evidenceRef
  const turn = meta.kind === 'turn'
  const command = meta.kind === 'command'
  const manual = meta.kind === 'manual'
  const passed = meta.exit === 0
  const source = meta.simulated === true ? '示例运行 · 没有真的跑' : meta.sample === true ? '样例数据' : turn ? '真的跑过 · 已保存' : manual ? '结果就绪 · 待验收' : '检查真的跑过'
  const summary = command
    ? `${passed ? '检查通过' : '检查没通过'}${typeof meta.durationMs === 'number' ? ` · 用时 ${(meta.durationMs / 1000).toFixed(1)}s` : ''}`
    : manual
      ? `${meta.workers?.length ?? 1} 位成员的结果已经好了 · 待验收`
      : turn
        ? `真的跑过 · ${((meta.durationMs ?? 0) / 1000).toFixed(1)}s`
        : `证据 · 第 ${(meta.stage ?? 0) + 1} 步`
  const chip = command ? (passed ? '已通过' : '未通过') : turn ? '这一轮' : manual ? '人工' : ''
  return h('div', {
    className: 'studio-result',
    'data-ok': command ? passed : undefined,
    'data-demo': meta.simulated === true || meta.sample === true,
  },
  member === null || member === undefined
    ? null
    : h('span', { className: 'studio-result-avatar' }, h(BotAvatar, { bot: member, size: 22, live: false })),
  member === null || member === undefined
    ? null
    : h('span', { className: 'studio-result-who' }, member.name),
  h('span', { className: 'studio-result-what' }, summary),
  chip === '' ? null : h('span', { className: 'studio-result-chip', 'data-pass': command ? passed : undefined }, chip),
  h('details', { className: 'studio-result-more' },
    h('summary', null, '证据'),
    h('div', { className: 'studio-result-body' },
      h('p', { className: 'crew-field-hint' }, source),
      command && meta.command ? h('div', { className: 'crew-kv' }, h('span', null, '检查'), h('code', null, meta.command)) : null,
      command && meta.exit !== undefined ? h('div', { className: 'crew-kv' }, h('span', null, '退出码'), h('code', null, String(meta.exit ?? '无'))) : null,
      meta.files?.length ? h('div', { className: 'crew-receipt-files' }, meta.files.join(' · ')) : null,
      turn && meta.artifacts?.length
        ? h('details', { className: 'crew-fold' }, h('summary', null, '结果'),
          meta.artifacts.map(artifact => h('div', { key: artifact.path },
            h('code', null, `${artifact.path.split('/').at(-1)} · 指纹 ${artifact.sha256.slice(0, 12)} · ${artifact.bytes} 字节`),
            h(CodeOutput, { text: artifact.content, limit: 200, hint: '打开结果文件查看完整内容' }))))
        : null,
      meta.output
        ? h('details', { className: 'crew-fold' }, h('summary', null, turn ? '原始记录' : '输出'), h(CodeOutput, { text: meta.output }))
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

function VerdictCard({ message, member, stage, room, onAccept, evidence }) {
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
  const shadow = shadowFor(room, message)
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotAvatar, { bot: member, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { member, ts: message.ts }),
      h('div', { className: 'crew-card crew-result-card', 'data-demo': meta.simulated === true, 'data-pass': pass },
        h('div', { className: 'crew-card-head' },
          '检查结果',
          h('span', { className: 'crew-verdict', 'data-pass': pass, 'data-reject': !pass }, pass ? '通过' : '退回')),
        h('div', { className: 'crew-card-body' },
          summary === '' ? null : h(Markdown, { text: summary, variant: 'compact' }),
          files.length > 0 ? h('div', { className: 'crew-receipt-files' }, files.join(' · ')) : null,
          diff === ''
            ? null
            : h('details', { className: 'crew-fold' }, h('summary', null, '改动'), h(CodeOutput, { text: diff, limit: 300 })),
          // 复核卡先给一句结论；完整理由按需展开，不占主阅读流。
          detail === ''
            ? null
            : h('details', { className: 'crew-fold' },
              h('summary', null, '为什么这样判断'),
              h(Markdown, { text: detail, variant: 'compact' })),
          shadow === null
            ? null
            : h('details', { className: 'crew-fold crew-check-second' },
              h('summary', null, `第二意见 · ${SHADOW_STATUS[shadow.status] ?? '参考'}`),
              typeof shadow.advice.summary === 'string' && shadow.advice.summary !== ''
                ? h('p', null, shadow.advice.summary)
                : null,
              shadow.advice.reasons?.length > 0
                ? h('p', { className: 'crew-field-hint' }, `理由：${shadow.advice.reasons.join('；')}`)
                : null,
              shadow.advice.risks?.length > 0
                ? h('p', { className: 'crew-field-hint' }, `风险：${shadow.advice.risks.join('；')}`)
                : null),
          command || (exit !== undefined && exit !== null) || output !== ''
            ? h('details', { className: 'crew-fold' },
              h('summary', null, '技术细节'),
              command ? h('div', { className: 'crew-kv' }, h('span', null, '命令'), h('code', null, command)) : null,
              exit !== undefined && exit !== null ? h('div', { className: 'crew-kv' }, h('span', null, '退出码'), h('code', null, String(exit))) : null,
              output === '' ? null : h(CodeOutput, { text: output }))
            : null),
        canAccept
          ? h('div', { className: 'crew-card-foot' },
            h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: room.state !== 'active',
              onClick: () => onAccept(meta.stage),
            }, room.state === 'paused' ? '已暂停 · 继续后才能验收' : '确认通过'))
          : null)))
}

export {
  EvidenceCard,
  VerdictCard,
}
