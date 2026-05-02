/**
 * End-to-end test for filters.deploymentID through getPaginatedSequences.
 *
 * Verifies the filter threads from the pagination service through to the SQL
 * layer and that returned sequences only contain media from the filtered
 * deployment.
 */

import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia
} from '../../../../src/main/database/index.js'
import { getPaginatedSequences } from '../../../../src/main/services/sequences/pagination.js'

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
  testStudyId = `test-pagination-deploymentfilter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-pagination-deployment-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seedTwoDeployments() {
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
  await insertMedia(manager, {
    'd1-a.jpg': {
      mediaID: 'd1-a',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
      filePath: '/d1-a.jpg',
      fileName: 'd1-a.jpg'
    },
    'd2-a.jpg': {
      mediaID: 'd2-a',
      deploymentID: 'd2',
      timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
      filePath: '/d2-a.jpg',
      fileName: 'd2-a.jpg'
    }
  })
}

describe('getPaginatedSequences — filters.deploymentID', () => {
  test('returns only sequences for the filtered deployment', async () => {
    await seedTwoDeployments()

    const result = await getPaginatedSequences(testDbPath, {
      gapSeconds: 60,
      limit: 50,
      cursor: null,
      filters: { deploymentID: 'd1' }
    })

    const allMediaIDs = result.sequences
      .flatMap((seq) => seq.items)
      .map((item) => item.mediaID)
    assert.deepEqual(allMediaIDs.sort(), ['d1-a'])
  })

  test('no deploymentID: returns sequences from all deployments', async () => {
    await seedTwoDeployments()

    const result = await getPaginatedSequences(testDbPath, {
      gapSeconds: 60,
      limit: 50,
      cursor: null,
      filters: {}
    })

    const allMediaIDs = result.sequences
      .flatMap((seq) => seq.items)
      .map((item) => item.mediaID)
    assert.deepEqual(allMediaIDs.sort(), ['d1-a', 'd2-a'])
  })
})
