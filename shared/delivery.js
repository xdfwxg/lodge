import { artifactKindOf } from './artifact.js'

export const deliveryKindOf = ({ artifacts = [], changedFiles = [], workspacePath = null } = {}) => {
  const kinds = [...new Set(artifacts.map(artifact => artifact?.kind ?? artifactKindOf(artifact?.path)))]
  if (kinds.length > 1) return 'mixed'
  if (kinds.length === 1) return kinds[0]
  return changedFiles.length > 0 || (typeof workspacePath === 'string' && workspacePath !== '')
    ? 'workspace'
    : 'empty'
}
