import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { collectOrphanDeployments } from '../../../../../src/main/services/import/parsers/orphanDeployments.js'

const tmpDirs = []

async function makeFixture(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orphan-test-'))
  tmpDirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content)
  }
  return dir
}

after(async () => {
  await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe('collectOrphanDeployments', () => {
  test('returns empty Map when neither media.csv nor observations.csv exists', async () => {
    const dir = await makeFixture({})
    const result = await collectOrphanDeployments({
      directoryPath: dir,
      knownDeploymentIDs: new Set()
    })
    assert.equal(result.size, 0)
  })

  test('returns empty Map when media.csv has only a header', async () => {
    const dir = await makeFixture({
      'media.csv': 'mediaID,deploymentID,timestamp\n'
    })
    const result = await collectOrphanDeployments({
      directoryPath: dir,
      knownDeploymentIDs: new Set()
    })
    assert.equal(result.size, 0)
  })

  test('returns empty Map when all media reference known deploymentIDs', async () => {
    const dir = await makeFixture({
      'media.csv': 'mediaID,deploymentID,timestamp\nm1,d1,2023-01-01T00:00:00Z\n'
    })
    const result = await collectOrphanDeployments({
      directoryPath: dir,
      knownDeploymentIDs: new Set(['d1'])
    })
    assert.equal(result.size, 0)
  })

  test('media: only orphan IDs in result with mediaCount and time window from min/max timestamp', async () => {
    const dir = await makeFixture({
      'media.csv':
        'mediaID,deploymentID,timestamp\n' +
        'm1,d1,2023-01-01T00:00:00Z\n' +
        'm2,d2,2023-02-01T00:00:00Z\n' +
        'm3,d2,2023-03-15T00:00:00Z\n' +
        'm4,d2,2023-01-15T00:00:00Z\n'
    })
    const result = await collectOrphanDeployments({
      directoryPath: dir,
      knownDeploymentIDs: new Set(['d1'])
    })
    assert.equal(result.size, 1)
    const d2 = result.get('d2')
    assert.deepEqual(d2, {
      start: '2023-01-15T00:00:00Z',
      end: '2023-03-15T00:00:00Z',
      mediaCount: 3,
      obsCount: 0
    })
  })

  test('observations: eventStart/eventEnd contribute when no media row covers the orphan', async () => {
    const dir = await makeFixture({
      'observations.csv':
        'observationID,deploymentID,mediaID,eventStart,eventEnd,scientificName\n' +
        'o1,d3,,2023-04-01T00:00:00Z,2023-04-01T00:01:00Z,Felis catus\n'
    })
    const result = await collectOrphanDeployments({
      directoryPath: dir,
      knownDeploymentIDs: new Set()
    })
    assert.equal(result.size, 1)
    const d3 = result.get('d3')
    assert.deepEqual(d3, {
      start: '2023-04-01T00:00:00Z',
      end: '2023-04-01T00:01:00Z',
      mediaCount: 0,
      obsCount: 1
    })
  })

  test('observations extend the window beyond the media bounds', async () => {
    const dir = await makeFixture({
      'media.csv': 'mediaID,deploymentID,timestamp\nm1,d1,2023-06-01T00:00:00Z\n',
      'observations.csv':
        'observationID,deploymentID,mediaID,eventStart,eventEnd\n' +
        'o1,d1,,2023-05-01T00:00:00Z,2023-07-01T00:00:00Z\n'
    })
    const result = await collectOrphanDeployments({
      directoryPath: dir,
      knownDeploymentIDs: new Set()
    })
    const d1 = result.get('d1')
    assert.equal(d1.start, '2023-05-01T00:00:00Z')
    assert.equal(d1.end, '2023-07-01T00:00:00Z')
    assert.equal(d1.mediaCount, 1)
    assert.equal(d1.obsCount, 1)
  })

  test('orphan with all-empty timestamps yields entry with NULL start/end', async () => {
    const dir = await makeFixture({
      'media.csv': 'mediaID,deploymentID,timestamp\nm1,d4,\n'
    })
    const result = await collectOrphanDeployments({
      directoryPath: dir,
      knownDeploymentIDs: new Set()
    })
    const d4 = result.get('d4')
    assert.equal(d4.mediaCount, 1)
    assert.equal(d4.start, null)
    assert.equal(d4.end, null)
  })

  test('aborted signal causes the function to reject with AbortError', async () => {
    const dir = await makeFixture({
      'media.csv': 'mediaID,deploymentID,timestamp\nm1,d1,2023-01-01T00:00:00Z\n'
    })
    const ac = new AbortController()
    ac.abort()
    await assert.rejects(
      () =>
        collectOrphanDeployments({
          directoryPath: dir,
          knownDeploymentIDs: new Set(),
          signal: ac.signal
        }),
      /abort|cancel/i
    )
  })

  test('empty deploymentID values in media are ignored (not stubbed)', async () => {
    const dir = await makeFixture({
      'media.csv':
        'mediaID,deploymentID,timestamp\nm1,,2023-01-01T00:00:00Z\nm2,d1,2023-02-01T00:00:00Z\n'
    })
    const result = await collectOrphanDeployments({
      directoryPath: dir,
      knownDeploymentIDs: new Set()
    })
    // Only d1 should be reported as orphan; the empty-string deploymentID is skipped.
    assert.equal(result.size, 1)
    assert.ok(result.has('d1'))
  })
})
