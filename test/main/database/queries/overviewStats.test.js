/**
 * Tests for getOverviewStats — consolidated stats payload for the Overview tab.
 */

import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getOverviewStats,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath
let testDbPath
let testStudyId
const utc = (value) => DateTime.fromISO(value, { zone: 'utc' })

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    // electron-log not available, that's fine
  }

  testStudyId = `test-overviewstats-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-overviewstats-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

describe('getOverviewStats', () => {
  test('empty study: all zeros, derivedRange both null', async () => {
    await createImageDirectoryDatabase(testDbPath)

    const stats = await getOverviewStats(testDbPath)

    assert.equal(stats.speciesCount, 0)
    assert.equal(stats.threatenedCount, 0)
    assert.equal(stats.cameraCount, 0)
    assert.equal(stats.locationCount, 0)
    assert.equal(stats.observationCount, 0)
    assert.equal(stats.cameraDays, 0)
    assert.equal(stats.mediaCount, 0)
    assert.equal(stats.derivedRange.start, null)
    assert.equal(stats.derivedRange.end, null)
  })

  test('study with deployments only: ranges fall back to deployment dates', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'Site A',
        deploymentStart: utc('2023-03-15T10:00:00Z'),
        deploymentEnd: utc('2023-06-15T18:00:00Z'),
        latitude: 46.7,
        longitude: 6.6,
        cameraID: 'cam1'
      },
      d2: {
        deploymentID: 'd2',
        locationID: 'loc2',
        locationName: 'Site B',
        deploymentStart: utc('2023-04-01T09:00:00Z'),
        deploymentEnd: utc('2023-08-01T19:00:00Z'),
        latitude: 46.8,
        longitude: 6.7,
        cameraID: 'cam2'
      }
    })

    const stats = await getOverviewStats(testDbPath)

    assert.equal(stats.cameraCount, 2)
    assert.equal(stats.locationCount, 2)
    assert.equal(stats.observationCount, 0)
    // derivedRange falls back to deployments
    assert.equal(stats.derivedRange.start, '2023-03-15')
    assert.equal(stats.derivedRange.end, '2023-08-01')
    // ~92 days + ~122 days = ~214 days. Allow ±2 for julianday math.
    assert.ok(
      stats.cameraDays >= 212 && stats.cameraDays <= 216,
      `cameraDays out of range: ${stats.cameraDays}`
    )
  })

  test('observations override deployment range; threatened count tallies VU/EN/CR', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'Site A',
        deploymentStart: utc('2023-01-01T00:00:00Z'),
        deploymentEnd: utc('2023-12-31T23:59:59Z'),
        latitude: 46.7,
        longitude: 6.6,
        cameraID: 'cam1'
      }
    })
    await insertMedia(manager, {
      'a.jpg': {
        mediaID: 'm1',
        deploymentID: 'd1',
        timestamp: utc('2023-04-15T10:00:00Z'),
        filePath: '/a.jpg',
        fileName: 'a.jpg'
      },
      'b.jpg': {
        mediaID: 'm2',
        deploymentID: 'd1',
        timestamp: utc('2023-09-20T12:00:00Z'),
        filePath: '/b.jpg',
        fileName: 'b.jpg'
      }
    })
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm1',
        deploymentID: 'd1',
        eventStart: utc('2023-04-15T10:00:00Z'),
        scientificName: 'Vulpes vulpes', // LC
        observationType: 'animal',
        count: 1
      },
      {
        observationID: 'o2',
        mediaID: 'm2',
        deploymentID: 'd1',
        eventStart: utc('2023-09-20T12:00:00Z'),
        scientificName: 'Acinonyx jubatus', // VU — counts as threatened
        observationType: 'animal',
        count: 1
      }
    ])

    const stats = await getOverviewStats(testDbPath)

    assert.equal(stats.speciesCount, 2)
    assert.equal(stats.threatenedCount, 1)
    assert.equal(stats.observationCount, 2)
    assert.equal(stats.mediaCount, 2)
    // observations override deployments for derivedRange
    assert.equal(stats.derivedRange.start, '2023-04-15')
    assert.equal(stats.derivedRange.end, '2023-09-20')
  })

  test('metadata.startDate/endDate override observations and deployments', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    // Set the override directly on the metadata table.
    const sqlite = manager.getSqlite()
    sqlite
      .prepare(
        'INSERT OR REPLACE INTO metadata (id, name, created, importerName, startDate, endDate) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(testStudyId, 'Test', new Date().toISOString(), 'test', '2020-01-01', '2024-12-31')
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'Site A',
        deploymentStart: utc('2023-01-01T00:00:00Z'),
        deploymentEnd: utc('2023-12-31T00:00:00Z'),
        latitude: 46.7,
        longitude: 6.6,
        cameraID: 'cam1'
      }
    })

    const stats = await getOverviewStats(testDbPath)
    assert.equal(stats.derivedRange.start, '2020-01-01')
    assert.equal(stats.derivedRange.end, '2024-12-31')
  })
})
