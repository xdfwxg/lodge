import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProjectView } from './project-view.js'
import { roundStatusOf } from './round-list.js'

const projects = [{
  id: 'project-1',
  name: '长期项目',
  northStar: '把长期目标做成可交付项目',
  rounds: [
    { id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'completed', goal: '先做一个能跑的原型' },
    { id: 'round-2', roomId: 'room-2', ordinal: 2, status: 'active', goal: '补上真实数据' },
  ],
}]

test('round status reads like a person, not a round enum', () => {
  assert.equal(roundStatusOf({ status: 'completed' }), '已交付')
  assert.equal(roundStatusOf({ status: 'active' }), '进行中')
  assert.equal(roundStatusOf({ status: 'planning' }), '待决定')
  assert.equal(roundStatusOf({ status: 'rejected' }), '已退回')
  assert.equal(roundStatusOf({ status: 'superseded' }), '已作废')
  assert.equal(roundStatusOf({ status: 'stopped' }), '已停止')
  assert.equal(roundStatusOf({}), '待开始')
})

test('a project page lists rounds, not a room chain', () => {
  const html = renderToStaticMarkup(h(ProjectView, {
    projects,
    rooms: [],
    projectId: 'project-1',
    onClose: () => {},
    onOpenRoom: () => {},
  }))
  assert.match(html, /长期项目/)
  assert.match(html, /把长期目标做成可交付项目/)
  assert.match(html, /2 轮/)
  assert.match(html, /先做一个能跑的原型/)
  assert.match(html, /补上真实数据/)
  assert.match(html, /进行中/)
  assert.doesNotMatch(html, /项目轨迹/)
})

test('a delivered latest round offers the next round in the same project', () => {
  const html = renderToStaticMarkup(h(ProjectView, {
    projects: [{
      ...projects[0],
      rounds: [{ ...projects[0].rounds[0] }],
    }],
    rooms: [{ id: 'room-1', defaultProjectId: 'project-1', repoPath: '/tmp/room-1' }],
    projectId: 'project-1',
    onClose: () => {},
    onOpenRoom: () => {},
    onStartRound: async () => ({ room: { id: 'room-1' } }),
    onRecommend: async () => ({ ok: true, proposal: { done: [], stages: [], questions: [] } }),
  }))
  assert.match(html, /下一轮要做什么/)
  assert.match(html, /开下一轮/)
  assert.match(html, /先出方案/)
})

test('a missing project is an honest empty state', () => {
  const html = renderToStaticMarkup(h(ProjectView, {
    projects: [],
    rooms: [],
    projectId: 'missing',
    onClose: () => {},
    onOpenRoom: () => {},
  }))
  assert.match(html, /项目还没连起来/)
})
