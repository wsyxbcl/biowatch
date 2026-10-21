import taxonomy from '../../shared/species/jingxi-taxonomy.json' with { type: 'json' }
import { JINGXI_ID, JINGXI_DELIVERY_VERSION } from '../../shared/jingxiModel.js'

// Chinese names for labels the classifier did not assign. Vehicle keeps the
// app's fixed pseudo-species label.
export const JINGXI_GENERIC_NAMES = { animal: '动物', 'homo sapiens': '人', unlabeled: '未分类' }

/**
 * Study-level vernacular names (CamtrapDP `taxonomic` shape) for Heinishi output.
 * Display layers prefer these over the shared English dictionary.
 */
export function jingxiTaxonomic() {
  return [
    ...taxonomy.entries.map((e) => [e.scientificName, e.chineseName]),
    ...Object.entries(JINGXI_GENERIC_NAMES)
  ].map(([scientificName, zho]) => ({ scientificName, vernacularNames: { zho } }))
}

const validProbability = (value) => Number.isFinite(value) && value >= 0 && value <= 1

export function buildJingxiObservations(raw) {
  if (
    raw?.model_id !== JINGXI_ID ||
    raw.model_version !== JINGXI_DELIVERY_VERSION ||
    raw.mapping_id !== taxonomy.deliveryMappingId ||
    raw.policy_id !== 'jingxi-md-redwood-top1-20261014'
  ) {
    throw new Error('Invalid Heinishi prediction identity')
  }
  if (!['classified', 'no_animal'].includes(raw.status))
    throw new Error('Heinishi prediction error')
  if (!Array.isArray(raw.detections)) throw new Error('Invalid detections')
  let taxon = null
  if (raw.status === 'classified') {
    const c = raw.classification
    const selected = raw.detections[raw.selected_detection_index]
    if (
      !Number.isInteger(raw.selected_detection_index) ||
      selected?.category !== '1' ||
      selected.conf < 0.3
    ) {
      throw new Error('Invalid selected detection')
    }
    taxon = taxonomy.entries[c?.raw_index]
    if (!Number.isInteger(c?.raw_index) || !taxon || taxon.rawLabel !== c.raw_label)
      throw new Error('Invalid class label')
    const p = c.probabilities
    if (
      !validProbability(c.raw_score) ||
      !Array.isArray(p) ||
      p.length !== 26 ||
      !p.every(validProbability) ||
      Math.abs(p.reduce((a, b) => a + b, 0) - 1) > 1e-4 ||
      Math.abs(p[c.raw_index] - c.raw_score) > 1e-6 ||
      p.some((v) => v > c.raw_score + 1e-6)
    )
      throw new Error('Invalid classification probabilities')
  } else if (raw.classification != null || raw.selected_detection_index != null) {
    throw new Error('Unexpected classification on no_animal')
  }
  const rows = raw.detections.map((d, index) => {
    const b = d.bbox
    if (
      !['1', '2', '3'].includes(d.category) ||
      !validProbability(d.conf) ||
      !Array.isArray(b) ||
      b.length !== 4 ||
      !b.every(validProbability) ||
      (taxon && index === raw.selected_detection_index && (b[2] === 0 || b[3] === 0)) ||
      b[0] + b[2] > 1.001 ||
      b[1] + b[3] > 1.001
    ) {
      throw new Error('Invalid detection bbox or confidence')
    }
    const classified = taxon && index === raw.selected_detection_index
    return {
      scientificName: classified
        ? taxon.scientificName
        : d.category === '2'
          ? 'homo sapiens'
          : d.category === '3'
            ? 'vehicle'
            : 'animal',
      commonName: classified
        ? taxon.chineseName
        : d.category === '2'
          ? JINGXI_GENERIC_NAMES['homo sapiens']
          : d.category === '3'
            ? 'Vehicle'
            : JINGXI_GENERIC_NAMES.animal,
      observationType: d.category === '2' ? 'human' : d.category === '3' ? 'vehicle' : 'animal',
      classificationProbability: classified ? raw.classification.raw_score : null,
      detectionConfidence: d.conf,
      bboxX: b[0],
      bboxY: b[1],
      bboxWidth: b[2],
      bboxHeight: b[3],
      count: 1
    }
  })
  return rows.length
    ? rows
    : [
        {
          scientificName: 'unlabeled',
          commonName: JINGXI_GENERIC_NAMES.unlabeled,
          classificationProbability: null,
          detectionConfidence: null,
          count: 1,
          bboxX: null,
          bboxY: null,
          bboxWidth: null,
          bboxHeight: null
        }
      ]
}

// File-level read/decode failures. Retrying can't fix these, so the job
// completes and the media stays without observations, as upstream does.
// Shared video path (utils.py) reports only a message.
const UNREADABLE_VIDEO =
  /^(Cannot open video|Invalid video metadata|Invalid FPS for video|Cannot decode image)\b/
// Runner reports {type, message}; it wraps decoding and inference in one try,
// so only these types (and PIL's plain OSError for damaged data) mean the
// file itself is bad. Anything else, e.g. CUDA out of memory, is retried.
const UNREADABLE_IMAGE_TYPES = new Set([
  'UnidentifiedImageError',
  'DecompressionBombError',
  'FileNotFoundError'
])
const UNREADABLE_OSERROR = /image file is truncated|broken data stream|cannot identify image/i

/**
 * Why a streamed Heinishi result can't be stored, or null when it can.
 * 'unreadable': the file can't be read or decoded; complete without retry.
 * 'failed': inference or contract error; fail the job so it is retried.
 */
export function heinishiPredictionProblem(prediction) {
  const runnerError = prediction?.jingxi?.status === 'error' ? prediction.jingxi.error : null
  if (runnerError || prediction?.prediction === 'error') {
    const type = runnerError?.type
    const message = String(runnerError?.message ?? prediction.error ?? 'unknown error')
    const unreadable = runnerError
      ? UNREADABLE_IMAGE_TYPES.has(type) || (type === 'OSError' && UNREADABLE_OSERROR.test(message))
      : !prediction.jingxi && UNREADABLE_VIDEO.test(message)
    return {
      kind: unreadable ? 'unreadable' : 'failed',
      message: type ? `${type}: ${message}` : message
    }
  }
  try {
    buildJingxiObservations(prediction?.jingxi)
    return null
  } catch (error) {
    return { kind: 'failed', message: error.message }
  }
}

export function jingxiTaxonomyProvenance(raw) {
  const entry = raw.classification ? taxonomy.entries[raw.classification.raw_index] : null
  return { mappingId: taxonomy.id, sourceSha256: taxonomy.sourceSha256, entry }
}
