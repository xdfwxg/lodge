import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTasks, markStageTasks, markTask } from './tasks.js'

const stage = {
  tasks: buildTasks({ stageIndex: 1, workers: ['甲', '乙'], seatNames: { 甲: '前端', 乙: '后端' } }),
}

test('stage tasks start working and track owner status and evidence', () => {
  assert.deepEqual(stage.tasks.map(task => [task.owner, task.title, task.status]), [
    ['甲', '前端', 'working'],
    ['乙', '后端', 'working'],
  ])
  const reported = markTask(stage, '甲', 'reported', 'evidence-1')
  assert.equal(reported.tasks[0].status, 'reported')
  assert.equal(reported.tasks[0].evidenceRef, 'evidence-1')
  assert.equal(reported.tasks[1].status, 'working')
  const done = markStageTasks(markTask(reported, '乙', 'failed'), 'done')
  assert.deepEqual(done.tasks.map(task => task.status), ['done', 'done'])
})
