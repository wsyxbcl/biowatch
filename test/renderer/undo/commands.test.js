import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import * as commands from '../../../src/renderer/src/undo/commands.js'

function fakeApi() {
  const calls = []
  return {
    calls,
    api: {
      createObservation: async (studyId, data) => {
        calls.push(['create', studyId, data])
        return { data: { ...data, observationID: data.observationID ?? 'new-id' } }
      },
      deleteObservation: async (studyId, id) => {
        calls.push(['delete', studyId, id])
        return { data: { success: true, observationID: id } }
      },
      updateObservationBbox: async (studyId, id, bbox) => {
        calls.push(['update-bbox', studyId, id, bbox])
        return { data: { observationID: id, ...bbox } }
      },
      updateObservationClassification: async (studyId, id, updates) => {
        calls.push(['update-classification', studyId, id, updates])
        return {
          data: {
            observationID: id,
            ...updates,
            classificationTimestamp: '2026-05-05T00:00:00.000Z'
          }
        }
      },
      restoreObservation: async (studyId, id, fields) => {
        calls.push(['restore', studyId, id, fields])
        return { data: { observationID: id, ...fields } }
      }
    }
  }
}

describe('commands.create', () => {
  test('forward calls createObservation; inverse calls deleteObservation', async () => {
    const { api, calls } = fakeApi()
    const cmd = commands.create({
      api,
      studyId: 's1',
      mediaId: 'm1',
      observationData: {
        mediaID: 'm1',
        deploymentID: 'd1',
        timestamp: 't',
        bboxX: 0.1,
        bboxY: 0.1,
        bboxWidth: 0.1,
        bboxHeight: 0.1
      }
    })

    await cmd.forward()
    assert.equal(calls[0][0], 'create')
    assert.equal(cmd.entry.type, 'create')
    assert.equal(cmd.entry.mediaId, 'm1')
    assert.ok(cmd.entry.after?.observationID)

    await cmd.inverse()
    assert.deepEqual(calls[1], ['delete', 's1', cmd.entry.after.observationID])

    await cmd.redo()
    const redoCall = calls[2]
    assert.equal(redoCall[0], 'create')
    assert.equal(redoCall[2].observationID, cmd.entry.after.observationID)
  })
})

describe('commands.delete_', () => {
  test('forward calls deleteObservation; inverse calls createObservation with original IDs', async () => {
    const { api, calls } = fakeApi()
    const before = {
      observationID: 'obs-X',
      eventID: 'evt-X',
      mediaID: 'm1',
      deploymentID: 'd1',
      eventStart: 't',
      eventEnd: 't',
      scientificName: 'capreolus capreolus',
      commonName: 'Roe Deer',
      observationType: 'animal',
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2,
      sex: null,
      lifeStage: null,
      behavior: null,
      classificationMethod: 'machine',
      classifiedBy: 'SpeciesNet 4.0.1a',
      classificationTimestamp: '2024-01-01T00:00:00.000Z',
      classificationProbability: 0.9
    }

    const cmd = commands.delete_({
      api,
      studyId: 's1',
      mediaId: 'm1',
      before
    })

    await cmd.forward()
    assert.deepEqual(calls[0], ['delete', 's1', 'obs-X'])
    assert.equal(cmd.entry.type, 'delete')
    assert.equal(cmd.entry.before.observationID, 'obs-X')

    await cmd.inverse()
    // Single IPC: createObservation with all original IDs + metadata.
    // No follow-up restore (collapsed to avoid partial-failure desync).
    assert.equal(calls.length, 2)
    const inverseCall = calls[1]
    assert.equal(inverseCall[0], 'create')
    assert.equal(inverseCall[2].observationID, 'obs-X')
    assert.equal(inverseCall[2].eventID, 'evt-X')
    assert.equal(inverseCall[2].scientificName, 'capreolus capreolus')
    assert.equal(inverseCall[2].classificationMethod, 'machine')
    assert.equal(inverseCall[2].classifiedBy, 'SpeciesNet 4.0.1a')
    assert.equal(inverseCall[2].classificationProbability, 0.9)
  })
})

describe('commands.updateBbox', () => {
  test('forward calls updateObservationBbox; inverse and redo call restoreObservation', async () => {
    const { api, calls } = fakeApi()
    const before = {
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2,
      classificationMethod: 'machine',
      classifiedBy: 'SpeciesNet 4.0.1a',
      classificationTimestamp: '2024-01-01T00:00:00.000Z',
      classificationProbability: 0.9
    }
    const after = { bboxX: 0.5, bboxY: 0.5, bboxWidth: 0.1, bboxHeight: 0.1 }
    const cmd = commands.updateBbox({
      api,
      studyId: 's1',
      mediaId: 'm1',
      observationId: 'obs-Y',
      before,
      after
    })

    await cmd.forward()
    assert.equal(calls[0][0], 'update-bbox')
    assert.deepEqual(calls[0][3], after)

    await cmd.inverse()
    assert.equal(calls[1][0], 'restore')
    assert.equal(calls[1][3].bboxX, 0.1)
    assert.equal(calls[1][3].classificationMethod, 'machine')

    await cmd.redo()
    assert.equal(calls[2][0], 'restore')
    assert.equal(calls[2][3].bboxX, 0.5)
  })
})

describe('commands.updateClassification', () => {
  test('forward calls updateObservationClassification; inverse calls restoreObservation', async () => {
    const { api, calls } = fakeApi()
    const before = {
      scientificName: 'lepus europaeus',
      commonName: 'European Hare',
      observationType: 'animal',
      sex: null,
      lifeStage: null,
      behavior: null,
      classificationMethod: 'machine',
      classifiedBy: 'SpeciesNet 4.0.1a',
      classificationTimestamp: '2024-01-01T00:00:00.000Z',
      classificationProbability: 0.85
    }
    const after = { scientificName: 'capreolus capreolus', commonName: 'Roe Deer' }
    const cmd = commands.updateClassification({
      api,
      studyId: 's1',
      mediaId: 'm1',
      observationId: 'obs-Z',
      before,
      after
    })

    await cmd.forward()
    assert.equal(calls[0][0], 'update-classification')

    await cmd.inverse()
    assert.equal(calls[1][0], 'restore')
    assert.equal(calls[1][3].scientificName, 'lepus europaeus')
    assert.equal(calls[1][3].classificationMethod, 'machine')
  })
})

describe('throws on IPC error response', () => {
  test('forward throws when api returns { error }', async () => {
    const api = {
      updateObservationBbox: async () => ({ error: 'DB error' })
    }
    const cmd = commands.updateBbox({
      api,
      studyId: 's1',
      mediaId: 'm1',
      observationId: 'obs-Y',
      before: { bboxX: 0.1, bboxY: 0.1, bboxWidth: 0.1, bboxHeight: 0.1 },
      after: { bboxX: 0.5, bboxY: 0.5, bboxWidth: 0.1, bboxHeight: 0.1 }
    })

    await assert.rejects(() => cmd.forward(), /DB error/)
  })
})
