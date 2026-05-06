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
  getMediaCountForDeployment,
  getObservationCountForDeployment,
  getBlankMediaCountForDeployment
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
    // ok in non-electron envs
  }
  testStudyId = `test-deploy-stats-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-deploy-stats', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seed(dbPath) {
  const manager = await createImageDirectoryDatabase(dbPath)

  await insertDeployments(manager, {
    deploy001: {
      deploymentID: 'deploy001',
      locationID: 'loc001',
      locationName: 'Site A',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-01-10T00:00:00Z'),
      latitude: 0,
      longitude: 0
    },
    deploy002: {
      deploymentID: 'deploy002',
      locationID: 'loc002',
      locationName: 'Site B',
      deploymentStart: DateTime.fromISO('2024-02-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-02-02T00:00:00Z'),
      latitude: 0,
      longitude: 0
    },
    deploy003: {
      deploymentID: 'deploy003',
      locationID: 'loc003',
      locationName: 'Site C',
      deploymentStart: DateTime.fromISO('2024-03-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-03-02T00:00:00Z'),
      latitude: 0,
      longitude: 0
    }
  })

  await insertMedia(manager, {
    'm1.jpg': {
      mediaID: 'm1',
      deploymentID: 'deploy001',
      timestamp: DateTime.fromISO('2024-01-02T10:00:00Z'),
      filePath: 'm1.jpg',
      fileName: 'm1.jpg',
      importFolder: '.',
      folderName: '.'
    },
    'm2.jpg': {
      mediaID: 'm2',
      deploymentID: 'deploy001',
      timestamp: DateTime.fromISO('2024-01-03T10:00:00Z'),
      filePath: 'm2.jpg',
      fileName: 'm2.jpg',
      importFolder: '.',
      folderName: '.'
    },
    'm3.jpg': {
      mediaID: 'm3',
      deploymentID: 'deploy001',
      timestamp: DateTime.fromISO('2024-01-04T10:00:00Z'),
      filePath: 'm3.jpg',
      fileName: 'm3.jpg',
      importFolder: '.',
      folderName: '.'
    },
    'm4.jpg': {
      mediaID: 'm4',
      deploymentID: 'deploy002',
      timestamp: DateTime.fromISO('2024-02-01T10:00:00Z'),
      filePath: 'm4.jpg',
      fileName: 'm4.jpg',
      importFolder: '.',
      folderName: '.'
    }
  })

  await insertObservations(manager, [
    {
      observationID: 'o1',
      mediaID: 'm1',
      deploymentID: 'deploy001',
      eventStart: DateTime.fromISO('2024-01-02T10:00:00Z'),
      eventEnd: DateTime.fromISO('2024-01-02T10:00:30Z'),
      scientificName: 'Cervus elaphus',
      count: 1
    },
    {
      observationID: 'o2',
      mediaID: 'm1',
      deploymentID: 'deploy001',
      eventStart: DateTime.fromISO('2024-01-02T10:00:00Z'),
      eventEnd: DateTime.fromISO('2024-01-02T10:00:30Z'),
      scientificName: 'Vulpes vulpes',
      count: 1
    },
    {
      observationID: 'o3',
      mediaID: 'm2',
      deploymentID: 'deploy001',
      eventStart: DateTime.fromISO('2024-01-03T10:00:00Z'),
      eventEnd: DateTime.fromISO('2024-01-03T10:00:30Z'),
      scientificName: 'Sus scrofa',
      count: 1
    },
    {
      observationID: 'o4',
      mediaID: 'm3',
      deploymentID: 'deploy001',
      eventStart: DateTime.fromISO('2024-01-04T10:00:00Z'),
      eventEnd: DateTime.fromISO('2024-01-04T10:00:30Z'),
      scientificName: '',
      count: 0
    },
    {
      observationID: 'o5',
      mediaID: 'm4',
      deploymentID: 'deploy002',
      eventStart: DateTime.fromISO('2024-02-01T10:00:00Z'),
      eventEnd: DateTime.fromISO('2024-02-01T10:00:30Z'),
      scientificName: 'Capreolus capreolus',
      count: 1
    }
  ])

  return manager
}

describe('getMediaCountForDeployment', () => {
  test('returns the number of media for a deployment', async () => {
    await seed(testDbPath)
    assert.equal(await getMediaCountForDeployment(testDbPath, 'deploy001'), 3)
    assert.equal(await getMediaCountForDeployment(testDbPath, 'deploy002'), 1)
  })

  test('returns 0 for a deployment with no media', async () => {
    await seed(testDbPath)
    assert.equal(await getMediaCountForDeployment(testDbPath, 'deploy003'), 0)
  })

  test('returns 0 for an unknown deploymentID', async () => {
    await seed(testDbPath)
    assert.equal(await getMediaCountForDeployment(testDbPath, 'does-not-exist'), 0)
  })
})

describe('getObservationCountForDeployment', () => {
  test('returns the total observations (including blanks) for a deployment', async () => {
    await seed(testDbPath)
    assert.equal(await getObservationCountForDeployment(testDbPath, 'deploy001'), 4)
    assert.equal(await getObservationCountForDeployment(testDbPath, 'deploy002'), 1)
  })

  test('returns 0 for a deployment with no observations', async () => {
    await seed(testDbPath)
    assert.equal(await getObservationCountForDeployment(testDbPath, 'deploy003'), 0)
  })
})

describe('getBlankMediaCountForDeployment (existing helper, contract-locked here)', () => {
  test('counts media that have no real (named-species or vehicle) observation', async () => {
    await seed(testDbPath)
    assert.equal(await getBlankMediaCountForDeployment(testDbPath, 'deploy001'), 1)
    assert.equal(await getBlankMediaCountForDeployment(testDbPath, 'deploy002'), 0)
    assert.equal(await getBlankMediaCountForDeployment(testDbPath, 'deploy003'), 0)
  })
})
