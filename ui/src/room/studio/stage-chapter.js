import { createElement as h } from 'react'

const stateLabel = state => (
  state === 'passed' ? '已完成' : state === 'active' ? '进行中' : '待开始'
)

// 阶段是工作室时间线的章节：当前阶段展开，已完成阶段收成一行。
export function StageChapter({ chapter, children }) {
  const title = chapter.index < 0 ? chapter.title : `阶段 ${chapter.index + 1} · ${chapter.title}`
  return h('section', { className: 'studio-stage-chapter', 'data-state': chapter.state },
    h('details', { className: 'studio-stage', open: chapter.expanded || undefined },
      h('summary', { className: 'studio-stage-head' },
        h('span', { className: 'studio-stage-title' }, title),
        h('span', { className: 'studio-stage-state' }, stateLabel(chapter.state)),
        h('span', { className: 'studio-stage-summary' }, chapter.summary)),
      h('div', { className: 'studio-stage-body' }, children)))
}
