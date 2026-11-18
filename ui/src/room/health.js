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
  const busyNames = (Array.isArray(room?.busyMembers) ? room.busyMembers : [])
    .map(id => (room.members ?? []).find(item => item.id === id)?.name ?? id)
    .filter(name => typeof name === 'string' && name !== '')
  return {
    index,
    title: stages[index].title ?? '',
    diagnostic,
    memberName: member?.name ?? diagnostic?.memberId ?? '',
    busyNames,
    at: diagnostic?.at === undefined ? null : diagnostic.at,
    usage: usageText(room?.usage),
    reworks,
    human,
    memoryCount: Array.isArray(room?.sharedMemory) ? room.sharedMemory.length : 0,
    needsYou: room?.needsYou ?? null,
  }
}

// 第一行只回答“现在需要你做什么”；费用、回合和返工收进展开后的详情。
export const healthLineOf = health => {
  if (health === null || health === undefined) return ''
  const needs = health.needsYou
  if (needs !== null && needs !== undefined) {
    const detail = typeof needs.detail === 'string' ? needs.detail.trim() : ''
    const label = needs.label ?? '需要你处理'
    return detail === '' ? `需要你：${label}` : `需要你：${label} · ${detail}`
  }
  const step = `第 ${health.index + 1} 步「${health.title}」`
  if (health.diagnostic === null) return `${step} · 刚开始`
  const actor = (health.busyNames ?? []).length > 0 ? health.busyNames.join('、') : health.memberName
  return actor === '' ? `${step} · 正在做` : `${step} · ${actor}在做`
}

export function RoomHealth({ room, onForgetMemory = null }) {
  const health = healthOf(room)
  if (health === null) return null
  if (health.diagnostic === null && health.needsYou === null && health.usage === '') return null
  const assessment = health.diagnostic?.assessment ?? null
  const metrics = [
    health.usage,
    health.reworks > 0 ? `返工 ${health.reworks} 次` : '',
    health.human > 0 ? `你介入 ${health.human} 次` : '',
    health.memoryCount > 0 ? `参考 ${health.memoryCount} 条记忆` : '',
  ].filter(Boolean).join(' · ')
  return h('details', { className: 'crew-health' },
    h('summary', null, healthLineOf(health)),
    h('div', { className: 'crew-health-body' },
      metrics === '' ? null : h('p', { className: 'crew-health-metrics' }, metrics),
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
