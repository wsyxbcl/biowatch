/**
 * Tests for getBlankMediaCount — counts media that have no animal, human,
 * or vehicle observation. Covers media with zero observation rows AND
 * media whose only observations are blank/unclassified/unknown-typed.
 */

import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getBlankMediaCount,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
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
  testStudyId = `test-blank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-blank-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seedDeploymentAndMedia(mediaCount) {
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
  const mediaRecords = {}
  for (let i = 0; i < mediaCount; i++) {
    mediaRecords[`m${i}.jpg`] = {
      mediaID: `m${i}`,
      deploymentID: 'd1',
      timestamp: DateTime.fromISO(`2024-01-01T00:0${i}:00Z`),
      filePath: `/m${i}.jpg`,
      fileName: `m${i}.jpg`
    }
  }
  await insertMedia(manager, mediaRecords)
  return manager
}

describe('getBlankMediaCount', () => {
  test('counts media with zero observations', async () => {
    await seedDeploymentAndMedia(3)
    const count = await getBlankMediaCount(testDbPath)
    assert.equal(count, 3)
  })

  test('counts media whose only observations are blank-typed (no species)', async () => {
    const manager = await seedDeploymentAndMedia(2)
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'blank',
        scientificName: null
      },
      {
        observationID: 'o2',
        mediaID: 'm1',
        deploymentID: 'd1',
        observationType: 'unclassified',
        scientificName: null
      }
    ])
    const count = await getBlankMediaCount(testDbPath)
    assert.equal(count, 2)
  })

  test('counts media whose only observations are unknown-typed', async () => {
    const manager = await seedDeploymentAndMedia(1)
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'unknown',
        scientificName: null
      }
    ])
    const count = await getBlankMediaCount(testDbPath)
    assert.equal(count, 1)
  })

  test('does NOT count media with an animal observation', async () => {
    const manager = await seedDeploymentAndMedia(1)
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'animal',
        scientificName: 'Sus scrofa'
      }
    ])
    const count = await getBlankMediaCount(testDbPath)
    assert.equal(count, 0)
  })

  test('does NOT count media with a vehicle observation', async () => {
    const manager = await seedDeploymentAndMedia(1)
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'vehicle',
        scientificName: null
      }
    ])
    const count = await getBlankMediaCount(testDbPath)
    assert.equal(count, 0)
  })

  test('does NOT count media that has both a blank-typed AND an animal observation', async () => {
    const manager = await seedDeploymentAndMedia(1)
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'blank',
        scientificName: null
      },
      {
        observationID: 'o2',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'animal',
        scientificName: 'Sus scrofa'
      }
    ])
    const count = await getBlankMediaCount(testDbPath)
    assert.equal(count, 0)
  })

  test('counts a mix of zero-obs and blank-typed-only media', async () => {
    const manager = await seedDeploymentAndMedia(3)
    // m0 has a blank-typed observation
    // m1 has no observations
    // m2 has an animal observation
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'blank',
        scientificName: null
      },
      {
        observationID: 'o2',
        mediaID: 'm2',
        deploymentID: 'd1',
        observationType: 'animal',
        scientificName: 'Vulpes vulpes'
      }
    ])
    const count = await getBlankMediaCount(testDbPath)
    assert.equal(count, 2)
  })
})
