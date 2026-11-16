// 任务级状态地基：只记录谁在做哪一步与证据引用；完整目标模型在第二阶段。
export const buildTasks = ({ stageIndex, workers, memberLabels = {} }) => (
  workers.map(owner => ({
    id: `${stageIndex}:${owner}`,
    title: memberLabels[owner] ?? owner,
    owner,
    status: 'working',
    evidenceRef: null,
  }))
)

export const markTask = (stage, owner, status, evidenceRef = null) => {
  if (!Array.isArray(stage?.tasks)) return stage
  return {
    ...stage,
    tasks: stage.tasks.map(task => (
      task.owner === owner
        ? { ...task, status, ...(evidenceRef === null ? {} : { evidenceRef }) }
        : task
    )),
  }
}

export const markStageTasks = (stage, status) => {
  if (!Array.isArray(stage?.tasks)) return stage
  return { ...stage, tasks: stage.tasks.map(task => ({ ...task, status })) }
}
