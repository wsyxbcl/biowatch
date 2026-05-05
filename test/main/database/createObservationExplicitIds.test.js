import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  createObservation
} from '../../../src/main/database/index.js'

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    /* ok */
  }

  testStudyId = `test-create-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-create-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seedDeploymentAndMedia() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1',
      locationID: 'loc1',
      locationName: 'Test',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
      latitude: 0,
      longitude: 0
    }
  })
  await insertMedia(manager, {
    'img.jpg': {
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-01-01T00:00:00Z'),
      filePath: '/fake/img.jpg',
      fileName: 'img.jpg'
    }
  })
}

describe('createObservation with explicit IDs', () => {
  test('uses provided observationID and eventID instead of generating new ones', async () => {
    await seedDeploymentAndMedia()

    const created = await createObservation(testDbPath, {
      observationID: 'fixed-obs-uuid',
      eventID: 'fixed-event-uuid',
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: '2024-01-01T00:00:00.000Z',
      scientificName: 'capreolus capreolus',
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2
    })

    assert.equal(created.observationID, 'fixed-obs-uuid')
    assert.equal(created.eventID, 'fixed-event-uuid')
  })

  test('still generates UUIDs when IDs are not provided', async () => {
    await seedDeploymentAndMedia()

    const created = await createObservation(testDbPath, {
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: '2024-01-01T00:00:00.000Z',
      scientificName: 'capreolus capreolus',
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2
    })

    assert.match(created.observationID, /^[0-9a-f-]{36}$/)
    assert.match(created.eventID, /^[0-9a-f-]{36}$/)
  })

  test('preserves caller-provided classification metadata (used by undo-of-delete)', async () => {
    await seedDeploymentAndMedia()

    const created = await createObservation(testDbPath, {
      observationID: 'metadata-obs',
      eventID: 'metadata-evt',
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: '2024-01-01T00:00:00.000Z',
      scientificName: 'capreolus capreolus',
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2,
      observationType: 'animal',
      classificationMethod: 'machine',
      classifiedBy: 'SpeciesNet 4.0.1a',
      classificationTimestamp: '2023-06-01T00:00:00.000Z',
      classificationProbability: 0.92
    })

    // When metadata is supplied (undo-of-delete path), the row keeps it
    // verbatim instead of being auto-stamped as 'human' / 'User' / now.
    assert.equal(created.classificationMethod, 'machine')
    assert.equal(created.classifiedBy, 'SpeciesNet 4.0.1a')
    assert.equal(created.classificationTimestamp, '2023-06-01T00:00:00.000Z')
    assert.equal(created.classificationProbability, 0.92)
    assert.equal(created.observationType, 'animal')
  })

  test('still auto-stamps when metadata is omitted (direct user creation)', async () => {
    await seedDeploymentAndMedia()

    const created = await createObservation(testDbPath, {
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: '2024-01-01T00:00:00.000Z',
      scientificName: 'capreolus capreolus',
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2
    })

    assert.equal(created.classificationMethod, 'human')
    assert.equal(created.classifiedBy, 'User')
    assert.equal(created.classificationProbability, null)
    assert.match(created.classificationTimestamp, /^\d{4}-\d{2}-\d{2}T/)
  })

  test('rejects a second insert with the same observationID', async () => {
    await seedDeploymentAndMedia()

    await createObservation(testDbPath, {
      observationID: 'duplicate-uuid',
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: '2024-01-01T00:00:00.000Z',
      scientificName: 'capreolus capreolus',
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2
    })

    await assert.rejects(
      () =>
        createObservation(testDbPath, {
          observationID: 'duplicate-uuid',
          mediaID: 'm1',
          deploymentID: 'd1',
          timestamp: '2024-01-01T00:00:00.000Z',
          scientificName: 'lepus europaeus',
          bboxX: 0.3,
          bboxY: 0.3,
          bboxWidth: 0.2,
          bboxHeight: 0.2
        }),
      /UNIQUE/
    )
  })
})
