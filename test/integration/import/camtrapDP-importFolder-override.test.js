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

  testBiowatchDataPath = join(
    tmpdir(),
    'biowatch-camtrap-importFolder-override-test',
    Date.now().toString()
  )
  mkdirSync(testBiowatchDataPath, { recursive: true })
  testCamTrapDataPath = join(process.cwd(), 'test', 'data', 'camtrap-derive-location-id')
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

function readImportFolders(dbPath) {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db
      .prepare('SELECT DISTINCT importFolder FROM media')
      .all()
      .map((r) => r.importFolder)
  } finally {
    db.close()
  }
}

// Regression coverage for the GBIF/Demo "extracted /tmp path leaks into Sources tab"
// bug. The handlers that download into a non-package-spec'd location pass
// importFolderOverride to suppress the directoryPath stamp on media.importFolder;
// silently dropping the option (e.g. by refactoring insertCSVData →
// transformRowToSchema → transformMediaRow) would re-introduce the bug.
describe('CamTrap-DP importFolderOverride option', () => {
  test('default: media.importFolder is stamped with directoryPath (spec D3)', async () => {
    const studyId = 'importfolder-default'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const folders = readImportFolders(dbPath)

    assert.equal(folders.length, 1, 'all media rows should share one importFolder')
    assert.equal(
      folders[0],
      testCamTrapDataPath,
      'importFolder should be the package directory path'
    )
  })

  test('importFolderOverride: null leaves media.importFolder NULL', async () => {
    const studyId = 'importfolder-null'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId, null, {
      importFolderOverride: null
    })

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const folders = readImportFolders(dbPath)

    assert.equal(folders.length, 1, 'all media rows should share one importFolder value')
    assert.equal(folders[0], null, 'importFolder should be NULL — Sources falls back to studyName')
  })

  test('importFolderOverride: custom string is honored verbatim', async () => {
    const studyId = 'importfolder-custom'
    const custom = 'gbif:13101e81-bc62-4553-9fd9-c5c8eb3fb9ab'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId, null, {
      importFolderOverride: custom
    })

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const folders = readImportFolders(dbPath)

    assert.equal(folders.length, 1)
    assert.equal(folders[0], custom)
  })
})
