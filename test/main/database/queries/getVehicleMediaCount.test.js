/**
 * Tests for getVehicleMediaCount — counts media that has at least one
 * vehicle observation (observationType = 'vehicle').
 */

import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getVehicleMediaCount,
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
  testStudyId = `test-vehicle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-vehicle-test', testStudyId)
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

describe('getVehicleMediaCount', () => {
  test('counts media with at least one vehicle observation', async () => {
    const manager = await seedDeploymentAndMedia(2)
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'vehicle',
        scientificName: null
      }
    ])
    const count = await getVehicleMediaCount(testDbPath)
    assert.equal(count, 1)
  })

  test('counts media that has both a vehicle AND an animal observation', async () => {
    const manager = await seedDeploymentAndMedia(1)
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'vehicle',
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
    const count = await getVehicleMediaCount(testDbPath)
    assert.equal(count, 1)
  })

  test('does NOT count media with only animal observations', async () => {
    const manager = await seedDeploymentAndMedia(1)
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'animal',
        scientificName: 'Vulpes vulpes'
      }
    ])
    const count = await getVehicleMediaCount(testDbPath)
    assert.equal(count, 0)
  })

  test('does NOT count media with only blank/unclassified observations', async () => {
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
    const count = await getVehicleMediaCount(testDbPath)
    assert.equal(count, 0)
  })

  test('counts each media at most once even with multiple vehicle obs', async () => {
    const manager = await seedDeploymentAndMedia(1)
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'vehicle',
        scientificName: null
      },
      {
        observationID: 'o2',
        mediaID: 'm0',
        deploymentID: 'd1',
        observationType: 'vehicle',
        scientificName: null
      }
    ])
    const count = await getVehicleMediaCount(testDbPath)
    assert.equal(count, 1)
  })
})
