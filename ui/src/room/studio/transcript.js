import { Fragment, createElement as h, useMemo } from 'react'
import { buildTimeline, dedupeChatStreams } from '../timeline-model.js'
import { describeSteps, displayableStep } from './transcript-model.js'
import { ShadowAdvice } from './advisor-advice.js'
import { renderStudioMessage } from './message-view.js'

const orderOf = message => (
  (typeof message.ts === 'number' ? message.ts : 0) * 1000 + (typeof message.seq === 'number' ? message.seq : 0)
)

// 工作室时间线就是一条聊天记录：规划师排期、交接、执行、验收、退回都在同一条线上，
// 不切章节、不截窗口、不隐藏阶段结论；细节挂在各自的消息里，需要时再展开。
export function StudioTranscript({
  room,
  members,
  onAccept,
  onStageAccept,
  onAnswerCard = null,
  onCancelQueue = null,
  onSteerQueue = null,
  onContinue = null,
  onReturn = null,
  onRework = null,
  hideKinds = [],
  delivery = null,
}) {
  const byId = useMemo(() => Object.fromEntries(members.map(member => [member.id, member])), [members])
  const messages = useMemo(
    () => dedupeChatStreams(room.messages).slice().sort((a, b) => orderOf(a) - orderOf(b)),
    [room.messages],
  )
  const timeline = useMemo(() => buildTimeline(messages), [messages])
  const hidden = useMemo(() => new Set(hideKinds), [hideKinds])
  // 同一个人把同一句话既写进聊天又从证据里回来时，只留聊天那一句。
  const renderable = useMemo(() => {
    const normalize = text => String(text ?? '')
      .replace(/^\s*(PASS|REJECT)\b[\s:：\-/]*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    const chatKey = message => `${message.authorId}|${normalize(message.text)}`
    const chats = new Set(messages.filter(message => message.kind === 'chat').map(chatKey))
    const verdicts = new Set(messages.filter(message => message.kind === 'verdict').map(chatKey))
    const consumed = new Set(messages
      .filter(message => message.kind === 'verdict' && typeof message.meta?.evidenceId === 'string')
      .map(message => message.meta.evidenceId))
    return messages.filter(message => {
      // 工作式聊天只留人和成员说的话；系统小字不占时间线。
      if (message.kind === 'system' || message.authorId === 'system') return false
      // 基座把运行提示混进 activity：没有工具名的行不是谁说的话，直接不显示。
      if (message.kind === 'activity' && !displayableStep(message)) return false
      if (message.kind === 'evidence') {
        if (consumed.has(message.id)) return false
        if (chats.has(chatKey(message))) return false
      }
      if (message.kind === 'chat' && verdicts.has(chatKey(message))) return false
      return true
    })
  }, [messages])

  const items = []
  for (let index = 0; index < renderable.length; index += 1) {
    const message = renderable[index]
    if (hidden.has(message.kind)) continue
    let shown = message
    // 同一个人的连续工具步骤合成一行，聊天里不铺终端日志。
    if (message.kind === 'activity') {
      const batch = [message]
      while (
        renderable[index + 1]?.kind === 'activity' &&
        renderable[index + 1]?.authorId === message.authorId
      ) {
        index += 1
        batch.push(renderable[index])
      }
      shown = {
        ...message,
        id: `steps-${message.id}`,
        kind: 'activity_steps',
        text: describeSteps(batch),
        meta: { ...message.meta, ok: batch.every(item => item.meta?.ok !== false) },
      }
    }
    const content = renderStudioMessage({
      room,
      byId,
      message: shown,
      timeline,
      onAccept,
      onStageAccept,
      onAnswerCard,
      onCancelQueue,
      onSteerQueue,
    })
    if (content !== null && content !== undefined) items.push(content)
  }

  const activeIndex = (room.stages ?? []).findIndex(stage => stage.state === 'active')
  const advice = activeIndex >= 0
    ? h(ShadowAdvice, { key: `advice-${activeIndex}`, room, stageIndex: activeIndex, label: '影子评审（仅供参考）' })
    : null

  return h(Fragment, null,
    h('div', { className: 'studio-timeline' }, ...items),
    advice)
}
