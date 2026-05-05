function unwrap(response) {
  if (response.error) throw new Error(response.error)
  return response.data
}

const BBOX_RESTORE_FIELDS = [
  'bboxX',
  'bboxY',
  'bboxWidth',
  'bboxHeight',
  'classificationMethod',
  'classifiedBy',
  'classificationTimestamp',
  'classificationProbability'
]

const CLASSIFICATION_RESTORE_FIELDS = [
  'scientificName',
  'commonName',
  'observationType',
  'sex',
  'lifeStage',
  'behavior',
  'classificationMethod',
  'classifiedBy',
  'classificationTimestamp',
  'classificationProbability'
]

function pick(obj, keys) {
  const out = {}
  for (const k of keys) out[k] = obj?.[k] ?? null
  return out
}

export function create({ api, studyId, mediaId, observationData }) {
  const entry = {
    type: 'create',
    mediaId,
    observationId: null,
    before: null,
    after: null
  }

  return {
    entry,
    forward: async () => {
      const data = unwrap(await api.createObservation(studyId, observationData))
      entry.observationId = data.observationID
      entry.after = data
    },
    inverse: async () => {
      unwrap(await api.deleteObservation(studyId, entry.observationId))
    },
    redo: async () => {
      // Recreate with the same observationID + eventID so any later stack
      // entries that reference this observation remain valid.
      unwrap(
        await api.createObservation(studyId, {
          ...entry.after,
          mediaID: entry.after.mediaID,
          deploymentID: entry.after.deploymentID,
          timestamp: entry.after.eventStart,
          observationID: entry.after.observationID,
          eventID: entry.after.eventID
        })
      )
    }
  }
}

// `delete` is a reserved word in JS — exported as `delete_`. Callers use
// `commands.delete_(...)`.
export function delete_({ api, studyId, mediaId, before }) {
  const entry = {
    type: 'delete',
    mediaId,
    observationId: before.observationID,
    before,
    after: null
  }

  return {
    entry,
    forward: async () => {
      unwrap(await api.deleteObservation(studyId, before.observationID))
    },
    inverse: async () => {
      // Recreate with the original IDs *and* the original classification
      // metadata in one IPC. createObservation accepts these as optional
      // overrides — when provided, it skips the auto-stamp that would
      // otherwise rewrite the row as 'human' / 'User' / now. This collapses
      // what used to be two IPCs (create + stamp-free restore) into one,
      // eliminating the partial-failure window where the row could come back
      // with the wrong metadata if the second IPC threw.
      unwrap(
        await api.createObservation(studyId, {
          mediaID: before.mediaID,
          deploymentID: before.deploymentID,
          timestamp: before.eventStart,
          observationID: before.observationID,
          eventID: before.eventID,
          scientificName: before.scientificName,
          commonName: before.commonName,
          bboxX: before.bboxX,
          bboxY: before.bboxY,
          bboxWidth: before.bboxWidth,
          bboxHeight: before.bboxHeight,
          sex: before.sex,
          lifeStage: before.lifeStage,
          behavior: before.behavior,
          observationType: before.observationType,
          classificationMethod: before.classificationMethod,
          classifiedBy: before.classifiedBy,
          classificationTimestamp: before.classificationTimestamp,
          classificationProbability: before.classificationProbability
        })
      )
    },
    redo: async () => {
      unwrap(await api.deleteObservation(studyId, before.observationID))
    }
  }
}

export function updateBbox({ api, studyId, mediaId, observationId, before, after }) {
  const beforeFields = pick(before, BBOX_RESTORE_FIELDS)
  const afterFields = {
    ...beforeFields,
    ...pick(after, ['bboxX', 'bboxY', 'bboxWidth', 'bboxHeight'])
  }

  const entry = {
    type: 'update-bbox',
    mediaId,
    observationId,
    before: beforeFields,
    after: afterFields
  }

  return {
    entry,
    forward: async () => {
      unwrap(
        await api.updateObservationBbox(studyId, observationId, {
          bboxX: after.bboxX,
          bboxY: after.bboxY,
          bboxWidth: after.bboxWidth,
          bboxHeight: after.bboxHeight
        })
      )
    },
    inverse: async () => {
      unwrap(await api.restoreObservation(studyId, observationId, beforeFields))
    },
    redo: async () => {
      unwrap(await api.restoreObservation(studyId, observationId, afterFields))
    }
  }
}

export function updateClassification({ api, studyId, mediaId, observationId, before, after }) {
  const beforeFields = pick(before, CLASSIFICATION_RESTORE_FIELDS)
  const afterFields = {
    ...beforeFields,
    ...after,
    classificationMethod: 'human',
    classifiedBy: 'User',
    classificationProbability: null
    // classificationTimestamp gets re-stamped by the forward IPC; capture the
    // actual value once forward() resolves.
  }

  const entry = {
    type: 'update-classification',
    mediaId,
    observationId,
    before: beforeFields,
    after: afterFields
  }

  return {
    entry,
    forward: async () => {
      const data = unwrap(await api.updateObservationClassification(studyId, observationId, after))
      if (data?.classificationTimestamp) {
        afterFields.classificationTimestamp = data.classificationTimestamp
      }
    },
    inverse: async () => {
      unwrap(await api.restoreObservation(studyId, observationId, beforeFields))
    },
    redo: async () => {
      unwrap(await api.restoreObservation(studyId, observationId, afterFields))
    }
  }
}
