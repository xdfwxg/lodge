import { createElement as h } from 'react'
import { renderSharedMessage, resolveMember } from '../message-view.js'
import { ChatLine, Speaker } from '../../message-cards.js'
import { QuestionCard } from '../question-card.js'
import { splitVerdictText } from './verdict-text.js'
import { cardStateOf } from '../../../../shared/attempt.js'
import { judgmentOf } from '../../../../shared/judgment.js'

const SEVERITY_LABEL = { blocker: '阻断', major: '重要', minor: '次要' }

// 工作室就是聊天：成员说什么就是一条消息，细节（命令、输出、改动）折在消息下面。
const fold = (label, text) => (
  typeof text !== 'string' || text.trim() === ''
    ? null
    : h('details', { className: 'crew-fold crew-msg-fold' },
      h('summary', null, label),
      h('pre', { className: 'crew-code' }, text))
)

export const renderStudioMessage = ({
  room,
  byId,
  message,
  timeline,
  onAccept,
  onStageAccept,
  onAnswerCard = null,
  onCancelQueue = null,
  onSteerQueue = null,
}) => {
  const member = resolveMember(room, byId, message)

  if (message.kind === 'verdict' && message.meta?.human === true) return null

  const chat = (text, extra = null, key = message.id) => h('div', { key, className: 'crew-msg-wrap' },
    h(ChatLine, { message: { ...message, text }, member }),
    extra)

  // 规划师的排期是一条消息，步骤直接读得出来。
  if (message.kind === 'plan') return chat(message.text)

  // 交接在群里就是一句 @：谁交给谁，下一步做什么。
  if (message.kind === 'dispatch' || message.kind === 'handoff') return chat(message.text ?? '')

  if (message.kind === 'question') {
    const messages = Array.isArray(room?.messages) ? room.messages : []
    return h(QuestionCard, {
      key: message.id,
      message,
      member,
      onAnswer: onAnswerCard,
      state: cardStateOf(room, message, messages),
    })
  }

  // 证据和验收都是成员的话；命令、退出码、diff 折在下面。
  if (message.kind === 'evidence') {
    const meta = message.meta ?? {}
    const detail = [
      typeof meta.command === 'string' && meta.command !== '' ? `$ ${meta.command}` : '',
      meta.exit === undefined || meta.exit === null ? '' : `退出码 ${meta.exit}`,
      typeof meta.diff === 'string' ? meta.diff : '',
    ].filter(Boolean).join('\n')
    if (message.authorId === 'system') {
      return h('div', { key: message.id, className: 'crew-msg-wrap' },
        h('div', { className: 'crew-system' }, message.text ?? ''),
        fold('检查明细', detail))
    }
    return chat(message.text ?? '', fold('检查明细', detail))
  }

  if (message.kind === 'verdict') {
    const judgment = judgmentOf(message)
    const source = judgment === null || judgment.source === 'legacy' ? message.text : (judgment.reason || message.text)
    const verdict = splitVerdictText(source)
    const passed = judgment !== null ? judgment.decision === 'pass' : message.meta?.pass === true
    const text = verdict.summary || (passed ? '符合这一步的要求。' : '这一步还不行，需要重做。')
    const findings = judgment?.findings ?? []
    return h('div', { key: message.id, className: 'crew-msg crew-msg-chat' },
      h('div', { className: 'crew-msg-body' },
        h(Speaker, { member, ts: message.ts, time: false, station: false }),
        h('div', { className: 'crew-verdict-card', 'data-pass': passed ? 'true' : 'false' },
          h('span', { className: 'crew-verdict-tag' }, passed ? '通过' : '退回'),
          h('span', { className: 'crew-verdict-text' }, text,
            findings.length === 0
              ? null
              : h('span', { className: 'crew-verdict-findings' },
                findings.slice(0, 3).map(finding => h('span', {
                  key: `${finding.title}-${finding.severity}`,
                  className: 'crew-verdict-finding',
                }, `${SEVERITY_LABEL[finding.severity] ?? finding.severity} · ${finding.title}`))))),
        fold('理由', verdict.detail || (judgment?.actionRequired
          ? `要你做：${judgment.actionRequired}`
          : ''))))
  }

  // 工厂日志不进房间：需要看过程时去交付详情或诊断里找。
  if (message.kind === 'activity_steps' || message.kind === 'activity') return null

  if (message.kind === 'chat' && message.authorId !== 'you') {
    return h(ChatLine, { key: message.id, message, member })
  }

  return renderSharedMessage({ room, byId, message, onAnswerCard, onCancelQueue, onSteerQueue })
}
