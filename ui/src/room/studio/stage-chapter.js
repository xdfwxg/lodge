import { createElement as h } from 'react'

const stateLabel = state => (
  state === 'passed' ? '已完成' : state === 'active' ? '正在做' : '还没开始'
)

// 阶段是工作室时间线的章节：当前阶段展开，已完成阶段收成一行。
export function StageChapter({ chapter, children, conclusion = null }) {
  const prelude = chapter.kind === 'prelude'
  const title = prelude ? chapter.title : `第 ${chapter.index + 1} 步 · ${chapter.title}`
  if (prelude) {
    return h('section', { className: 'studio-stage-chapter studio-prelude' },
      h('div', { className: 'studio-prelude-head' }, title),
      h('div', { className: 'studio-prelude-body' }, children))
  }
  const hasBody = Array.isArray(children)
    ? children.flat(Infinity).some(Boolean)
    : children !== undefined && children !== null && children !== false
  const content = [
    h('span', { key: 'title', className: 'studio-stage-title' }, title),
    prelude || (chapter.state === 'passed' && chapter.summary !== '')
      ? null
      : h('span', { key: 'state', className: 'studio-stage-state' }, stateLabel(chapter.state)),
    chapter.summary === ''
      ? null
      : h('span', { key: 'summary', className: 'studio-stage-summary' }, chapter.summary),
  ]
  const commands = conclusion?.commands ?? []
  const passed = commands.filter(command => command.exit === 0).length
  const checks = commands.length > 0 ? `${passed}/${commands.length} 项检查通过` : '人工验收通过'
  // 结论跟随交付名；阶段名只出现在阶段头，不写死任何样本标题。
  const conclusionBody = conclusion === null
    ? null
    : h('div', { className: 'studio-stage-conclusion' },
      h('span', {
        className: 'studio-stage-conclusion-mark',
        'data-pass': commands.length === 0 || passed === commands.length,
        'aria-hidden': 'true',
      }, commands.length === 0 || passed === commands.length ? '✓' : '×'),
      h('span', { className: 'studio-stage-conclusion-text' }, conclusion.name || '这次做出来的'),
      h('span', { className: 'studio-stage-conclusion-meta' }, checks),
      h('span', { className: 'studio-stage-conclusion-hint' }, '结果见上方'))
  if (hasBody) {
    return h('section', { className: 'studio-stage-chapter', 'data-state': chapter.state ?? undefined },
      h('details', { className: 'studio-stage', open: chapter.expanded || undefined },
        h('summary', { className: 'studio-stage-head' }, content),
        h('div', { className: 'studio-stage-body' }, children)))
  }
  if (conclusionBody !== null) {
    return h('section', { className: 'studio-stage-chapter', 'data-state': chapter.state ?? undefined },
      h('details', { className: 'studio-stage', open: true },
        h('summary', { className: 'studio-stage-head' }, content),
        h('div', { className: 'studio-stage-body' }, conclusionBody)))
  }
  return h('section', { className: 'studio-stage-chapter', 'data-state': chapter.state ?? undefined },
    h('div', { className: 'studio-stage studio-stage-static' },
      h('div', { className: 'studio-stage-head' }, content)))
}
