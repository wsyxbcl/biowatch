import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import fs from 'fs/promises'

import {
  getStudyCacheStatsImpl,
  clearStudyCacheImpl
} from '../../../../src/main/services/cache/study.js'

let testStudiesPath

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    // ok
  }
  testStudiesPath = join(tmpdir(), 'biowatch-cache-study-test', Date.now().toString())
  mkdirSync(testStudiesPath, { recursive: true })
})

afterEach(() => {
  if (existsSync(testStudiesPath)) {
    rmSync(testStudiesPath, { recursive: true, force: true })
  }
})

/**
 * Write `count` files of `sizeBytes` each into <studiesPath>/<studyId>/cache/<subdir>/.
 */
async function seedSubdir(studyId, subdir, count, sizeBytes) {
  const dir = join(testStudiesPath, studyId, 'cache', subdir)
  await fs.mkdir(dir, { recursive: true })
  for (let i = 0; i < count; i++) {
    await fs.writeFile(join(dir, `f${i}`), Buffer.alloc(sizeBytes))
  }
}

describe('getStudyCacheStatsImpl', () => {
  test('returns all zeros when cache dir does not exist', async () => {
    await fs.mkdir(join(testStudiesPath, 'study-1'), { recursive: true })

    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.deepEqual(result.total, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.transcodes, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.thumbnails, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.images, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.videos, { bytes: 0, files: 0 })
  })

  test('returns all zeros when cache dir is empty', async () => {
    await fs.mkdir(join(testStudiesPath, 'study-1', 'cache'), { recursive: true })

    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.equal(result.total.bytes, 0)
    assert.equal(result.total.files, 0)
  })

  test('aggregates bytes and files across all four subtypes', async () => {
    await seedSubdir('study-1', 'transcodes', 2, 1024) // 2 files × 1 KB
    await seedSubdir('study-1', 'thumbnails', 3, 512) // 3 files × 0.5 KB
    await seedSubdir('study-1', 'images', 4, 256) // 4 files × 0.25 KB
    await seedSubdir('study-1', 'videos', 1, 2048) // 1 file × 2 KB

    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.deepEqual(result.breakdown.transcodes, { bytes: 2048, files: 2 })
    assert.deepEqual(result.breakdown.thumbnails, { bytes: 1536, files: 3 })
    assert.deepEqual(result.breakdown.images, { bytes: 1024, files: 4 })
    assert.deepEqual(result.breakdown.videos, { bytes: 2048, files: 1 })
    assert.equal(result.total.bytes, 2048 + 1536 + 1024 + 2048)
    assert.equal(result.total.files, 10)
  })

  test('counts unknown cache subdirs in total but not in any breakdown bucket', async () => {
    await seedSubdir('study-1', 'transcodes', 1, 1000)
    await seedSubdir('study-1', 'future-cache-type', 2, 500) // 2 × 500 B = 1000 B

    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.deepEqual(result.breakdown.transcodes, { bytes: 1000, files: 1 })
    assert.deepEqual(result.breakdown.thumbnails, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.images, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.videos, { bytes: 0, files: 0 })
    assert.equal(result.total.bytes, 2000, 'total includes the unknown subdir')
    assert.equal(result.total.files, 3)
  })

  test('walks nested directories inside a cache subtype', async () => {
    const nested = join(testStudiesPath, 'study-1', 'cache', 'transcodes', 'sub')
    await fs.mkdir(nested, { recursive: true })
    await fs.writeFile(join(nested, 'a.mp4'), Buffer.alloc(800))
    await fs.writeFile(
      join(testStudiesPath, 'study-1', 'cache', 'transcodes', 'b.mp4'),
      Buffer.alloc(200)
    )

    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.deepEqual(result.breakdown.transcodes, { bytes: 1000, files: 2 })
  })
})

describe('clearStudyCacheImpl', () => {
  test('returns zeros when cache dir does not exist', async () => {
    await fs.mkdir(join(testStudiesPath, 'study-1'), { recursive: true })

    const result = await clearStudyCacheImpl(testStudiesPath, 'study-1')

    assert.equal(result.freedBytes, 0)
    assert.equal(result.clearedFiles, 0)
    assert.equal(result.error, undefined)
  })

  test('removes cache dir and returns matching freed totals', async () => {
    await seedSubdir('study-1', 'transcodes', 2, 1000)
    await seedSubdir('study-1', 'images', 3, 500)

    const result = await clearStudyCacheImpl(testStudiesPath, 'study-1')

    assert.equal(result.freedBytes, 2 * 1000 + 3 * 500)
    assert.equal(result.clearedFiles, 5)
    assert.equal(
      existsSync(join(testStudiesPath, 'study-1', 'cache')),
      false,
      'cache dir is removed'
    )
  })

  test('subsequent stats call returns zeros after clear', async () => {
    await seedSubdir('study-1', 'transcodes', 2, 1000)

    await clearStudyCacheImpl(testStudiesPath, 'study-1')
    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.equal(result.total.bytes, 0)
    assert.equal(result.total.files, 0)
  })
})
