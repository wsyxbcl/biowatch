import { test } from 'node:test'
import assert from 'node:assert/strict'

export function rawPrediction() {
  const probabilities = Array(26).fill(0)
  probabilities[10] = 1
  return {
    model_id: 'maze-speciesnet-jingxi',
    model_version: '0.1.0-experimental',
    mapping_id: 'jingxi-v4-maze-mapping-20261014',
    policy_id: 'jingxi-md-redwood-top1-20261014',
    status: 'classified',
    selected_detection_index: 1,
    detections: [
      { category: '2', conf: 0.9, bbox: [0.1, 0.1, 0.1, 0.1] },
      { category: '1', conf: 0.4, bbox: [0.3, 0.3, 0.1, 0.1] },
      { category: '1', conf: 0.1, bbox: [0.5, 0.5, 0.1, 0.1] }
    ],
    classification: { raw_index: 10, raw_label: '猪', raw_score: 1, probabilities }
  }
}

test('rejects a zero-area classified box', async () => {
  const { buildJingxiObservations } = await import('../../../src/main/services/jingxiPrediction.js')
  const raw = rawPrediction()
  raw.detections[1].bbox[2] = 0
  assert.throws(() => buildJingxiObservations(raw), /bbox/)
})

test('only the selected box receives a species and classifier probability', async () => {
  const { buildJingxiObservations } = await import('../../../src/main/services/jingxiPrediction.js')
  const raw = rawPrediction()
  const original = JSON.stringify(raw)
  const rows = buildJingxiObservations(raw)
  assert.equal(rows[0].scientificName, 'homo sapiens')
  assert.equal(rows[1].scientificName, 'sus scrofa domesticus')
  assert.equal(rows[1].classificationProbability, 1)
  assert.equal(rows[2].scientificName, 'animal')
  assert.equal(rows[2].classificationProbability, null)
  assert.equal(JSON.stringify(raw), original)
})

test('no detections are unlabeled, not blank; errors and invalid classifications fail', async () => {
  const { buildJingxiObservations } = await import('../../../src/main/services/jingxiPrediction.js')
  const raw = rawPrediction()
  assert.throws(() => buildJingxiObservations({ ...raw, selected_detection_index: 0 }), /selected/)
  assert.throws(() => buildJingxiObservations({ ...raw, status: 'error' }), /error/)
  assert.throws(
    () =>
      buildJingxiObservations({
        ...raw,
        classification: { ...raw.classification, raw_score: NaN }
      }),
    /probabilit/
  )
  const rows = buildJingxiObservations({
    ...raw,
    status: 'no_animal',
    classification: null,
    selected_detection_index: null,
    detections: [],
    no_animal_reason: 'no_detections'
  })
  assert.equal(rows[0].scientificName, 'unlabeled')
  assert.equal(rows[0].classificationProbability, null)
})

test('stores Chinese names and exposes them as study vernacular names', async () => {
  const { buildJingxiObservations, jingxiTaxonomic } =
    await import('../../../src/main/services/jingxiPrediction.js')
  const rows = buildJingxiObservations(rawPrediction())
  assert.deepEqual(
    rows.map((r) => [r.scientificName, r.commonName]),
    [
      ['homo sapiens', '人'],
      ['sus scrofa domesticus', '猪'],
      ['animal', '动物']
    ]
  )
  const names = Object.fromEntries(
    jingxiTaxonomic().map((t) => [t.scientificName, t.vernacularNames.zho])
  )
  assert.equal(names['sus scrofa'], '野猪')
  assert.equal(names['sus scrofa domesticus'], '猪')
  assert.equal(names.unlabeled, '未分类')
  assert.equal(Object.keys(names).length, 29)
})

test('only read/decode errors count as unreadable; inference errors still fail', async () => {
  const { heinishiPredictionProblem } =
    await import('../../../src/main/services/jingxiPrediction.js')
  const runnerError = (type, message) => ({
    prediction: 'error',
    jingxi: { ...rawPrediction(), status: 'error', error: { type, message } }
  })
  const kind = (prediction) => heinishiPredictionProblem(prediction)?.kind

  // Shared video path: OpenCV could not open the file, no Heinishi payload.
  assert.deepEqual(
    heinishiPredictionProblem({ prediction: 'error', error: 'Cannot open video: a.mp4' }),
    { kind: 'unreadable', message: 'Cannot open video: a.mp4' }
  )
  assert.equal(
    kind({ prediction: 'error', error: 'Invalid video metadata (fps=0): a.mp4' }),
    'unreadable'
  )
  assert.equal(
    kind(runnerError('UnidentifiedImageError', "cannot identify image file 'a.jpg'")),
    'unreadable'
  )
  assert.equal(
    kind(runnerError('OSError', 'image file is truncated (8 bytes not processed)')),
    'unreadable'
  )

  // Inference failures must stay retriable.
  assert.deepEqual(
    heinishiPredictionProblem(runnerError('OutOfMemoryError', 'CUDA out of memory')),
    {
      kind: 'failed',
      message: 'OutOfMemoryError: CUDA out of memory'
    }
  )
  assert.equal(kind(runnerError('RuntimeError', 'cuDNN error')), 'failed')
  assert.equal(kind(runnerError('OSError', 'No space left on device')), 'failed')
  assert.equal(kind({ prediction: 'error', error: 'something unexpected' }), 'failed')

  assert.equal(
    kind({ prediction: 'x', jingxi: { ...rawPrediction(), model_id: 'other' } }),
    'failed'
  )
  assert.equal(heinishiPredictionProblem({ prediction: '猪', jingxi: rawPrediction() }), null)
})
