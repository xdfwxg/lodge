import { createElement as h } from 'react'
import { dateTimeOf } from '../view-format.js'

const money = micro => {
  const usd = (Number(micro) || 0) / 1_000_000
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`
}

const usageText = usage => {
  if (usage === null || usage === undefined) return ''
  const turns = Number(usage.turns) || 0
  if (turns === 0) return ''
  const cost = usage.costStatus === 'unknown'
    ? '费用未知'
    : usage.costStatus === 'partial' ? `至少 ${money(usage.costMicroUsd)}` : money(usage.costMicroUsd)
  return `${turns} 回合 · ${cost}`
}

export const healthOf = room => {
  const stages = Array.isArray(room?.stages) ? room.stages : []
  const index = stages.findIndex(stage => stage.state === 'active')
  if (index < 0) return null
  const diagnostics = room?.stageDiagnostics ?? {}
  const diagnostic = diagnostics[index] ?? diagnostics[String(index)] ?? null
  const messages = Array.isArray(room?.messages) ? room.messages : []
  const stageOf = message => message?.meta?.stage
  const reworks = messages.filter(message => message.kind === 'rework' && stageOf(message) === index).length
  const human = messages.filter(message => message.kind === 'human-context' && stageOf(message) === index).length
  const member = diagnostic === null
    ? null
    : (room.members ?? []).find(item => item.id === diagnostic.memberId) ?? null
  return {
    index,
    title: stages[index].title ?? '',
    diagnostic,
    memberName: member?.name ?? diagnostic?.memberId ?? '',
    at: diagnostic?.at === undefined ? null : diagnostic.at,
    usage: usageText(room?.usage),
    reworks,
    human,
    memoryCount: Array.isArray(room?.sharedMemory) ? room.sharedMemory.length : 0,
    needsYou: room?.needsYou ?? null,
  }
}

export function RoomHealth({ room, onForgetMemory = null }) {
  const health = healthOf(room)
  if (health === null) return null
  if (health.diagnostic === null && health.needsYou === null && health.usage === '') return null
  const assessment = health.diagnostic?.assessment ?? null
  const summary = [
    `第 ${health.index + 1} 步「${health.title}」`,
    health.memberName === '' ? '' : health.memberName,
    health.diagnostic === null ? '还没有回合诊断' : `${assessment?.evidence?.length ?? 0} 条证据 · ${assessment?.unknown?.length ?? 0} 项未知`,
    health.usage,
    health.reworks > 0 ? `返工 ${health.reworks} 次` : '',
    health.human > 0 ? `你介入 ${health.human} 次` : '',
    health.memoryCount > 0 ? `参考 ${health.memoryCount} 条记忆` : '',
  ].filter(Boolean).join(' · ')
  return h('details', { className: 'crew-health' },
    h('summary', null, summary),
    h('div', { className: 'crew-health-body' },
      health.needsYou === null ? null : h('p', { className: 'crew-health-wait' },
        h('b', null, health.needsYou.label ?? '需要你处理'),
        health.needsYou.detail === undefined || health.needsYou.detail === '' ? null : ` · ${health.needsYou.detail}`),
      assessment === null
        ? null
        : h('div', { className: 'crew-health-grid' },
          h('div', null, h('b', null, '证据'), h('ul', null, (assessment.evidence ?? []).slice(0, 5).map(item => h('li', { key: item }, item)))),
          h('div', null, h('b', null, '未知'), h('ul', null, (assessment.unknown ?? []).slice(0, 5).map(item => h('li', { key: item }, item)))),
          h('div', null, h('b', null, '下一步'), h('ul', null, (assessment.next ?? []).slice(0, 5).map(item => h('li', { key: item }, item))))),
      health.memoryCount === 0 || onForgetMemory === null
        ? null
        : h('button', {
          type: 'button',
          className: 'crew-link',
          onClick: () => { void onForgetMemory() },
        }, '本次不用工作区记忆'),
      health.at === null ? null : h('p', { className: 'crew-health-time' }, dateTimeOf(health.at))))
}
