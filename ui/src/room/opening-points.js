import { createElement as h } from 'react'

const confirmationItems = room => (room.brief?.constraints ?? [])
  .filter(line => typeof line === 'string' && line.startsWith('已确认：'))
  .slice(0, 3)
  .map(line => {
    const text = line.replace(/^已确认：/, '')
    const [question, ...rest] = text.split('→')
    const answer = rest.join('→').trim()
    const label = /源文件|哪一个|哪个文件/.test(question)
      ? '源文件'
      : /改动|调整|方向/.test(question)
        ? '改动方向'
        : /交付物|尺寸|放到哪里/.test(question)
          ? '交付物'
          : null
    return { question: question.trim(), answer, label }
  })

export function ConfirmationPoints({ room }) {
  const items = confirmationItems(room)
  if (items.length === 0) return null
  return h('div', null,
    h('p', { className: 'crew-gate-points-label' }, '已对齐的内容：'),
    h('ul', { className: 'crew-gate-points' },
      items.map((item, at) => h('li', { key: `confirm-${at}` },
        item.label === null ? null : h('span', { className: 'crew-gate-point-label' }, item.label),
        h('span', { className: 'crew-gate-point-question' }, item.question),
        item.answer === '' ? null : h('b', { className: 'crew-gate-point-answer' }, item.answer)))))
}

export { confirmationItems }
