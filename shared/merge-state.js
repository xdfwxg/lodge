export const MERGE_STATE = Object.freeze({
  NONE: 'none',
  MERGING: 'merging',
  CONFLICT: 'conflict',
  RESOLVED: 'resolved',
})

export const mergeStateOf = (room, stage = null) => {
  const matches = value => value !== null && value !== undefined &&
    (stage === null || value.stage === stage)
  if (matches(room?.mergeConflict)) {
    return {
      state: MERGE_STATE.CONFLICT,
      stage: room.mergeConflict.stage,
      files: Array.isArray(room.mergeConflict.files) ? room.mergeConflict.files : [],
      versions: Array.isArray(room.mergeConflict.versions) ? room.mergeConflict.versions : [],
    }
  }
  if (matches(room?.mergeInProgress)) {
    return {
      state: MERGE_STATE.MERGING,
      stage: room.mergeInProgress.stage,
      files: [],
      versions: [],
    }
  }
  if (matches(room?.mergeResolved)) {
    return {
      state: MERGE_STATE.RESOLVED,
      stage: room.mergeResolved.stage,
      files: [],
      versions: [],
    }
  }
  return { state: MERGE_STATE.NONE, stage, files: [], versions: [] }
}
