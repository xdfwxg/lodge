// project 只是轮次分组，不执行、不验收、不保存证据副本。
export const createProjectStore = ({ db }) => {
  const writeProject = project => {
    const now = Date.now()
    const stored = {
      ...project,
      createdAt: project.createdAt ?? now,
      updatedAt: project.updatedAt ?? now,
      version: Number(project.version ?? 1),
    }
    db.prepare(
      'INSERT INTO project (id, payload, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at',
    ).run(stored.id, JSON.stringify(stored), stored.version, stored.createdAt, stored.updatedAt)
    return stored
  }

  const readProject = id => {
    const row = db.prepare('SELECT payload, version FROM project WHERE id = ?').get(id)
    if (row === undefined) return null
    return { ...JSON.parse(row.payload), version: row.version }
  }

  const readProjects = () => db.prepare('SELECT payload, version FROM project ORDER BY updated_at DESC').all()
    .map(row => ({ ...JSON.parse(row.payload), version: row.version }))

  const updateProject = (id, mutate) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT payload, version FROM project WHERE id = ?').get(id)
      if (row === undefined) { db.exec('ROLLBACK'); return null }
      const project = JSON.parse(row.payload)
      const change = mutate(project)
      if (change === null || change === undefined || change === false) { db.exec('ROLLBACK'); return null }
      const version = Number(row.version) + 1
      project.version = version
      project.updatedAt = Date.now()
      db.prepare('UPDATE project SET payload = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?')
        .run(JSON.stringify(project), version, project.updatedAt, id, row.version)
      db.exec('COMMIT')
      return project
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return { writeProject, readProject, readProjects, updateProject }
}
