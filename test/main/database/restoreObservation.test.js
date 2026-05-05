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
  insertObservations,
  restoreObservation
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
  testStudyId = `test-restore-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-restore-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seedObservation(overrides = {}) {
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
  await insertObservations(manager, [
    {
      observationID: 'obs1',
      mediaID: 'm1',
      deploymentID: 'd1',
      eventID: 'e1',
      eventStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      eventEnd: DateTime.fromISO('2024-01-01T00:00:00Z'),
      scientificName: 'capreolus capreolus',
      observationType: 'animal',
      classificationProbability: 0.95,
      count: 1,
      ...overrides
    }
  ])
}

describe('restoreObservation', () => {
  test('updates fields without overwriting classificationMethod / classifiedBy / classificationTimestamp', async () => {
    await seedObservation()

    const restored = await restoreObservation(testDbPath, 'obs1', {
      bboxX: 0.5,
      bboxY: 0.5,
      bboxWidth: 0.1,
      bboxHeight: 0.1,
      classificationMethod: 'machine',
      classifiedBy: 'SpeciesNet 4.0.1a',
      classificationTimestamp: '2023-12-01T00:00:00.000Z',
      classificationProbability: 0.95
    })

    assert.equal(restored.bboxX, 0.5)
    assert.equal(restored.classificationMethod, 'machine')
    assert.equal(restored.classifiedBy, 'SpeciesNet 4.0.1a')
    assert.equal(restored.classificationTimestamp, '2023-12-01T00:00:00.000Z')
    assert.equal(restored.classificationProbability, 0.95)
  })

  test('only updates the fields provided — leaves others untouched', async () => {
    await seedObservation({ scientificName: 'lepus europaeus' })

    const restored = await restoreObservation(testDbPath, 'obs1', {
      bboxX: 0.3,
      bboxY: 0.3,
      bboxWidth: 0.2,
      bboxHeight: 0.2
    })

    assert.equal(restored.scientificName, 'lepus europaeus')
    assert.equal(restored.bboxX, 0.3)
  })

  test('throws when no observation matches the id (0 rows affected)', async () => {
    await seedObservation()

    await assert.rejects(
      () => restoreObservation(testDbPath, 'no-such-obs', { bboxX: 0.1 }),
      /not found|0 rows/i
    )
  })
})
