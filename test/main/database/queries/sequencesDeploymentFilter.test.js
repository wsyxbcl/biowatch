/**
 * Tests for the deploymentID filter on getMediaForSequencePagination.
 *
 * Exercises both the timestamped phase and the null-timestamp phase, with
 * and without the filter. The 'no filter' case asserts the existing
 * behavior is preserved.
 */

import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getMediaForSequencePagination,
  hasTimestampedMedia,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    // not available, fine
  }

  testStudyId = `test-deploymentfilter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-deploymentfilter-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seed() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1',
      locationID: 'loc1',
      locationName: 'Site A',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 1,
      longitude: 1,
      cameraID: 'cam1'
    },
    d2: {
      deploymentID: 'd2',
      locationID: 'loc2',
      locationName: 'Site B',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 2,
      longitude: 2,
      cameraID: 'cam2'
    }
  })
  // d1 has 2 timestamped + 1 null-timestamp; d2 has 1 timestamped + 1 null-timestamp
  await insertMedia(manager, {
    'd1-a.jpg': {
      mediaID: 'd1-a',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
      filePath: '/d1-a.jpg',
      fileName: 'd1-a.jpg'
    },
    'd1-b.jpg': {
      mediaID: 'd1-b',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
      filePath: '/d1-b.jpg',
      fileName: 'd1-b.jpg'
    },
    'd1-null.jpg': {
      mediaID: 'd1-null',
      deploymentID: 'd1',
      timestamp: null,
      filePath: '/d1-null.jpg',
      fileName: 'd1-null.jpg'
    },
    'd2-a.jpg': {
      mediaID: 'd2-a',
      deploymentID: 'd2',
      timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'),
      filePath: '/d2-a.jpg',
      fileName: 'd2-a.jpg'
    },
    'd2-null.jpg': {
      mediaID: 'd2-null',
      deploymentID: 'd2',
      timestamp: null,
      filePath: '/d2-null.jpg',
      fileName: 'd2-null.jpg'
    }
  })
}

describe('getMediaForSequencePagination — deploymentID filter', () => {
  test('no filter: returns media from all deployments (timestamped phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null,
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {}
    })
    const ids = result.media.map((m) => m.mediaID).sort()
    assert.deepEqual(ids, ['d1-a', 'd1-b', 'd2-a'])
  })

  test('with deploymentID: only matching deployment (timestamped phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null,
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {},
      deploymentID: 'd1'
    })
    const ids = result.media.map((m) => m.mediaID).sort()
    assert.deepEqual(ids, ['d1-a', 'd1-b'])
  })

  test('with deploymentID: only matching deployment (null phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: { phase: 'null', offset: 0 },
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {},
      deploymentID: 'd1'
    })
    const ids = result.media.map((m) => m.mediaID).sort()
    assert.deepEqual(ids, ['d1-null'])
  })

  test('with non-existent deploymentID: empty result, no error', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null,
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {},
      deploymentID: 'does-not-exist'
    })
    assert.deepEqual(result.media, [])
  })
})

describe('hasTimestampedMedia — deploymentID filter', () => {
  test('no filter: true when any deployment has timestamped media', async () => {
    await seed()
    const result = await hasTimestampedMedia(testDbPath, {})
    assert.equal(result, true)
  })

  test('with deploymentID: false when that deployment has no timestamped media', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'Site A',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 1,
        longitude: 1,
        cameraID: 'cam1'
      }
    })
    await insertMedia(manager, {
      'd1-null.jpg': {
        mediaID: 'd1-null',
        deploymentID: 'd1',
        timestamp: null,
        filePath: '/d1-null.jpg',
        fileName: 'd1-null.jpg'
      }
    })
    const result = await hasTimestampedMedia(testDbPath, { deploymentID: 'd1' })
    assert.equal(result, false)
  })

  test('with deploymentID: true when that deployment has timestamped media', async () => {
    await seed()
    const result = await hasTimestampedMedia(testDbPath, { deploymentID: 'd1' })
    assert.equal(result, true)
  })
})
