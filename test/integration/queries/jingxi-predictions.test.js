import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createImageDirectoryDatabase,
  closeStudyDatabase,
  getMediaForSequencePagination,
  getSpeciesDistribution
} from '../../../src/main/database/index.js'
import {
  deployments,
  media,
  modelRuns,
  observations,
  modelOutputs
} from '../../../src/main/database/models.js'
import { insertPrediction, insertVideoPredictions } from '../../../src/main/services/prediction.js'

test('Heinishi videos use selected species, preserve frames and never turn no_animal into blank', async () => {
  const root = mkdtempSync(join(tmpdir(), 'heinishi-video-db-'))
  const manager = await createImageDirectoryDatabase(join(root, 'study.db'))
  try {
    const db = manager.getDb()
    await db.insert(deployments).values({ deploymentID: 'dep', locationName: 'Test' })
    await db.insert(modelRuns).values({
      id: 'run',
      modelID: 'maze-speciesnet-jingxi',
      modelVersion: '0.0.1',
      startedAt: '2026-01-01T00:00:00Z'
    })
    const record = {
      mediaID: 'v',
      deploymentID: 'dep',
      timestamp: '2026-01-01T00:00:00Z',
      filePath: '/test/a.mp4',
      fileName: 'a.mp4',
      fileMediatype: 'video/mp4'
    }
    await db.insert(media).values(record)
    const probabilities = Array(26).fill(0)
    probabilities[10] = 1
    const raw = {
      model_id: 'maze-speciesnet-jingxi',
      model_version: '0.1.0-experimental',
      mapping_id: 'jingxi-v4-maze-mapping-20261014',
      policy_id: 'jingxi-md-redwood-top1-20261014',
      status: 'classified',
      selected_detection_index: 0,
      detections: [{ category: '1', conf: 0.9, bbox: [0.1, 0.1, 0.5, 0.5] }],
      classification: { raw_index: 10, raw_label: '猪', raw_score: 1, probabilities }
    }
    const frames = [0, 30].map((frame_number) => ({
      filepath: record.filePath,
      model_version: '0.0.1',
      frame_number,
      metadata: { fps: 30, duration: 2 },
      prediction: '猪',
      prediction_score: 1,
      jingxi: raw
    }))
    const info = { runID: 'run', modelID: 'maze-speciesnet-jingxi', modelVersion: '0.0.1' }
    await insertVideoPredictions(db, frames, record, info)
    const rows = await db.select().from(observations)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].scientificName, 'sus scrofa domesticus')
    assert.match(rows[0].commonName, /猪/)
    assert.equal(Date.parse(rows[0].eventEnd) - Date.parse(rows[0].eventStart), 1000)
    assert.equal(rows[0].bboxX, null)
    const outputs = await db.select().from(modelOutputs)
    assert.deepEqual(outputs[0].rawOutput.frames, frames)
    const empty = { ...record, mediaID: 'empty', filePath: '/test/empty.mp4' }
    await db.insert(media).values(empty)
    await insertVideoPredictions(
      db,
      [
        {
          ...frames[0],
          filepath: empty.filePath,
          prediction: 'unlabeled',
          jingxi: {
            ...raw,
            status: 'no_animal',
            classification: null,
            selected_detection_index: null,
            detections: []
          }
        }
      ],
      empty,
      info
    )
    const all = await db.select().from(observations)
    assert.equal(all.find((row) => row.mediaID === 'empty').scientificName, 'unlabeled')

    // A briefly visible animal must win over a majority of empty or generic frames.
    const brief = { ...record, mediaID: 'brief', filePath: '/test/brief.mp4' }
    await db.insert(media).values(brief)
    const noBox = {
      ...raw,
      status: 'no_animal',
      classification: null,
      selected_detection_index: null,
      detections: []
    }
    const generic = { ...noBox, detections: [{ category: '1', conf: 0.2, bbox: [0, 0, 0.1, 0.1] }] }
    const briefFrames = [noBox, noBox, noBox, generic, generic, raw].map((jingxi, i) => ({
      ...frames[0],
      filepath: brief.filePath,
      frame_number: i * 30,
      jingxi
    }))
    await insertVideoPredictions(db, briefFrames, brief, info)
    const briefRow = (await db.select().from(observations)).find((row) => row.mediaID === 'brief')
    assert.equal(briefRow.scientificName, 'sus scrofa domesticus')
    assert.equal(briefRow.classificationProbability, 1)
  } finally {
    await closeStudyDatabase(manager.studyId)
    rmSync(root, { recursive: true, force: true })
  }
})

test('Heinishi unclassified media stay nonblank in the upstream SQLite queries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'heinishi-db-'))
  const path = join(root, 'study.db')
  const manager = await createImageDirectoryDatabase(path)
  try {
    const db = manager.getDb()
    await db.insert(deployments).values({ deploymentID: 'dep', locationName: 'Test' })
    await db.insert(media).values({
      mediaID: 'm',
      deploymentID: 'dep',
      timestamp: '2026-01-01T00:00:00Z',
      filePath: '/test/a.jpg',
      fileName: 'a.jpg',
      fileMediatype: 'image/jpeg'
    })
    await insertPrediction(
      db,
      {
        filepath: '/test/a.jpg',
        jingxi: {
          model_id: 'maze-speciesnet-jingxi',
          model_version: '0.1.0-experimental',
          mapping_id: 'jingxi-v4-maze-mapping-20261014',
          policy_id: 'jingxi-md-redwood-top1-20261014',
          status: 'no_animal',
          classification: null,
          selected_detection_index: null,
          detections: [],
          no_animal_reason: 'no_detections'
        }
      },
      { modelID: 'maze-speciesnet-jingxi', modelVersion: '0.0.1' }
    )
    const distribution = await getSpeciesDistribution(path)
    assert.ok(distribution.some((row) => row.scientificName === 'unlabeled'))
    const filtered = await getMediaForSequencePagination(path, { species: ['unlabeled'] })
    assert.ok(filtered.media.some((row) => row.mediaID === 'm'))
  } finally {
    await closeStudyDatabase(manager.studyId)
    rmSync(root, { recursive: true, force: true })
  }
})
