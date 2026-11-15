import { createElement as h } from 'react'

const stateLabel = state => (
  state === 'passed' ? '做完了' : state === 'active' ? '正在做' : '还没开始'
)

// 阶段是工作室时间线的章节：当前阶段展开，已完成阶段收成一行。
export function StageChapter({ chapter, children }) {
  const prelude = chapter.kind === 'prelude'
  const title = prelude ? chapter.title : `第 ${chapter.index + 1} 步 · ${chapter.title}`
  return h('section', { className: 'studio-stage-chapter', 'data-state': chapter.state ?? undefined },
    h('details', { className: 'studio-stage', open: chapter.expanded || undefined },
      h('summary', { className: 'studio-stage-head' },
        h('span', { className: 'studio-stage-title' }, title),
        prelude ? null : h('span', { className: 'studio-stage-state' }, stateLabel(chapter.state)),
        chapter.summary === '' ? null : h('span', { className: 'studio-stage-summary' }, chapter.summary)),
      h('div', { className: 'studio-stage-body' }, children)))
}
