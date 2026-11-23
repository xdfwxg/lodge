import { createElement as h } from 'react'
import { dateTimeOf, timeOf } from '../view-format.js'
import { needsAction } from '../needs.js'

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
  return `${turns} 轮 · ${cost}`
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
  // 这一步真的调用了哪些工具：一行一次，和“过程与费用”放在一起，不占主时间线。
  const membersById = new Map((room.members ?? []).map(item => [item.id, item]))
  // 只收有动作分类的工具调用；基座的 recent-work brief 不是工具。
  const activities = messages.filter(message => (
    message.kind === 'activity' &&
    message.authorId !== 'system' &&
    ['read', 'write', 'exec', 'gate'].includes(String(message?.meta?.action ?? ''))
  ))
  const tools = activities.slice(-12).map(message => ({
    id: message.id,
    kind: String(message.meta?.action ?? ''),
    name: String(message.text ?? '').trim() || '工具',
    member: membersById.get(message.authorId)?.name ?? '',
    ok: message.meta?.ok !== false,
    ts: message.ts,
  }))
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
    toolCount: activities.length,
    tools,
    needsYou: needsAction(room),
  }
}

// 第一行只回答“现在需要你做什么”；费用、回合和返工收进展开后的详情。
export const healthLineOf = health => {
  if (health === null || health === undefined) return ''
  const needs = health.needsYou
  if (needs !== null && needs !== undefined) return `待处理：${needs.label ?? '待处理'}`
  // 岛已经在讲“第几步、谁在做”；这里只留一个可展开的工作详情入口。
  return '过程与费用'
}

const TOOL_KIND_LABEL = { read: '读', write: '写', exec: '跑', gate: '判' }

export function RoomHealth({ room, onForgetMemory = null }) {
  const health = healthOf(room)
  if (health === null) return null
  // 岛已经在说“需要你”；这里只在房间自己跑的时候讲进度，避免同一件事说三遍。
  if (health.needsYou !== null) return null
  if (health.diagnostic === null && health.usage === '' && health.tools.length === 0) return null
  const assessment = health.diagnostic?.assessment ?? null
  const metrics = [
    health.usage,
    health.reworks > 0 ? `重做 ${health.reworks} 次` : '',
    health.human > 0 ? `你介入 ${health.human} 次` : '',
    health.memoryCount > 0 ? `参考 ${health.memoryCount} 条记忆` : '',
  ].filter(Boolean).join(' · ')
  return h('details', { className: 'crew-health' },
    h('summary', null, healthLineOf(health)),
    h('div', { className: 'crew-health-body' },
      typeof health.needsYou?.detail === 'string' && health.needsYou.detail !== ''
        ? h('p', { className: 'crew-health-wait' }, health.needsYou.detail)
        : null,
      metrics === '' ? null : h('p', { className: 'crew-health-metrics' }, metrics),
      health.tools.length === 0 ? null : h('div', { className: 'crew-tool-list' },
        h('div', { className: 'crew-tool-head' },
          h('span', null, '这一步的工具'),
          h('span', { className: 'crew-tool-count' }, health.toolCount > health.tools.length ? `最近 ${health.tools.length} / 共 ${health.toolCount} 次` : `${health.toolCount} 次`)),
        h('ul', null, health.tools.map(tool => h('li', {
          key: tool.id,
          className: 'crew-tool-row',
          'data-ok': tool.ok ? 'true' : 'false',
        },
        h('span', { className: 'crew-tool-kind', 'data-kind': tool.kind || 'other', 'aria-hidden': 'true' }, TOOL_KIND_LABEL[tool.kind] ?? '·'),
        h('code', { className: 'crew-tool-name' }, tool.name),
        tool.member === '' ? null : h('span', { className: 'crew-tool-member' }, tool.member),
        h('span', { className: 'crew-tool-time' }, timeOf(tool.ts)),
        h('span', { className: 'crew-tool-state', 'data-ok': tool.ok ? 'true' : 'false' }, tool.ok ? '' : '失败'))))),
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
