const line = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const oneLine = (value, max = 240) => {
  const text = line(value)
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

const passCommands = delivery => (delivery.commands ?? [])
  .filter(command => command.exit === 0 && command.simulated !== true)
  .map(command => `- \`${oneLine(command.command, 160)}\` → exit 0`)

const verdictLines = delivery => (delivery.stages ?? [])
  .flatMap(stage => (stage.verdicts ?? []).filter(verdict => verdict.pass === true))
  .slice(-3)
  .map(verdict => `- PASS：${oneLine(verdict.text, 180) || '验收通过'}`)

const beforeText = messages => {
  const rework = [...messages].reverse().find(message => message.kind === 'rework' && line(message.text) !== '')
  return rework === undefined ? '没有记录失败前状态' : oneLine(rework.text, 240)
}

const blastRadius = delivery => {
  const files = delivery.changedFiles ?? []
  if (files.length === 0) return '没有记录文件改动'
  const areas = [...new Set(files.map(file => String(file).split('/').slice(0, 2).join('/')))]
  return `${files.length} 个文件${areas.length > 0 ? `（${areas.slice(0, 4).join('、')}${areas.length > 4 ? '…' : ''}）` : ''}`
}

export const prDraftOf = (room, messages = [], delivery) => {
  if (delivery === null || delivery === undefined) return null
  const title = line(room?.name) || line(room?.goal) || 'Lodge delivery'
  const after = [...passCommands(delivery), ...verdictLines(delivery)]
  const body = [
    '## Summary',
    oneLine(room?.goal, 500) || title,
    '',
    '## Evidence',
    `- **Before:** ${beforeText(messages)}`,
    ...(after.length > 0 ? after.map(text => `- **After:** ${text.slice(2)}`) : ['- **After:** 没有记录可核对的检查']),
    '',
    '## Merge Danger',
    `**Door:** ${room?.workspace?.provider === 'direct' ? 'one-way' : 'two-way'}`,
    `**Blast Radius:** ${blastRadius(delivery)}`,
  ].join('\n')
  return {
    title,
    body,
    before: beforeText(messages),
    after: after.length > 0 ? after : ['没有记录可核对的检查'],
    door: room?.workspace?.provider === 'direct' ? 'one-way' : 'two-way',
    blastRadius: blastRadius(delivery),
  }
}
