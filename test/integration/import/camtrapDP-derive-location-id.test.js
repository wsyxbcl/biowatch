import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import { importCamTrapDatasetWithPath } from '../../../src/main/services/import/parsers/camtrapDP.js'

let testBiowatchDataPath
let testCamTrapDataPath

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // electron-log not available in test environment
  }

  testBiowatchDataPath = join(tmpdir(), 'biowatch-camtrap-derive-locID-test', Date.now().toString())
  mkdirSync(testBiowatchDataPath, { recursive: true })
  testCamTrapDataPath = join(process.cwd(), 'test', 'data', 'camtrap-derive-location-id')
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

function openDb(dbPath) {
  return new Database(dbPath, { readonly: true })
}

describe('CamTrap-DP locationID derivation from coordinates', () => {
  test('curator-provided locationID is preserved (never overwritten)', async () => {
    const studyId = 'derive-locid-curator'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const db = openDb(dbPath)
    try {
      const row = db
        .prepare("SELECT locationID FROM deployments WHERE deploymentID = 'd_curator'")
        .get()
      assert.equal(row.locationID, 'siteAlpha')
    } finally {
      db.close()
    }
  })

  test('empty locationID + coords yields geo:lat,lon with 4-decimal precision', async () => {
    const studyId = 'derive-locid-synth'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const db = openDb(dbPath)
    try {
      const a = db
        .prepare("SELECT locationID FROM deployments WHERE deploymentID = 'd_synth_a'")
        .get()
      assert.equal(a.locationID, 'biowatch-geo:46.5000,6.5000')
    } finally {
      db.close()
    }
  })

  test('two deployments at the same coords share the same synthesized locationID', async () => {
    const studyId = 'derive-locid-shared'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const db = openDb(dbPath)
    try {
      const a = db
        .prepare("SELECT locationID FROM deployments WHERE deploymentID = 'd_synth_a'")
        .get()
      const b = db
        .prepare("SELECT locationID FROM deployments WHERE deploymentID = 'd_synth_b'")
        .get()
      assert.equal(a.locationID, b.locationID)
      assert.match(a.locationID, /^biowatch-geo:/)
    } finally {
      db.close()
    }
  })

  test('coords differing in the 5th decimal collapse to the same geo: ID (~11 m precision)', async () => {
    const studyId = 'derive-locid-precision'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const db = openDb(dbPath)
    try {
      const a = db
        .prepare("SELECT locationID FROM deployments WHERE deploymentID = 'd_synth_a'")
        .get()
      const c = db
        .prepare("SELECT locationID FROM deployments WHERE deploymentID = 'd_synth_c'")
        .get()
      // d_synth_a is (46.5, 6.5), d_synth_c is (46.5, 6.50001) — both round to 6.5000
      assert.match(a.locationID ?? '', /^biowatch-geo:/, 'a should be synthesized')
      assert.equal(a.locationID, c.locationID)
    } finally {
      db.close()
    }
  })

  test('rows with no coords keep locationID = NULL (cannot synthesize)', async () => {
    const studyId = 'derive-locid-no-coords'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const db = openDb(dbPath)
    try {
      const row = db
        .prepare("SELECT locationID FROM deployments WHERE deploymentID = 'd_no_coords'")
        .get()
      assert.equal(row.locationID, null)
    } finally {
      db.close()
    }
  })

  test('singleton-coord deployment still gets a synthesized geo: ID', async () => {
    // No "needs aggregation" gating: any empty locationID + coords gets synthesis.
    const studyId = 'derive-locid-singleton'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const db = openDb(dbPath)
    try {
      const row = db
        .prepare("SELECT locationID FROM deployments WHERE deploymentID = 'd_unique'")
        .get()
      assert.equal(row.locationID, 'biowatch-geo:47.0000,7.0000')
    } finally {
      db.close()
    }
  })
})
