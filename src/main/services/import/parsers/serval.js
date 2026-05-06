import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'
import crypto from 'crypto'
import { DateTime } from 'luxon'
import { eq } from 'drizzle-orm'
import { fileURLToPath } from 'url'
import {
  getDrizzleDb,
  deployments,
  media,
  observations,
  closeStudyDatabase,
  insertMetadata
} from '../../../database/index.js'
import log from '../../logger.js'
import { getBiowatchDataPath } from '../../paths.js'
import { resolveCommonName } from '../../../../shared/commonNames/index.js'
import { normalizeScientificName } from '../../../../shared/commonNames/normalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../../../..')
const BUNDLED_TAGLIST_RELATIVE_PATH = path.join('resources', 'taxonomy', 'serval-taglist.csv')

function cleanCell(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
}

function normalizeLookupKey(value) {
  const cleaned = cleanCell(value)
  if (!cleaned) return null
  return cleaned.normalize('NFC').toLowerCase().replace(/\s+/g, ' ')
}

function isBlankTaxonValue(value) {
  const key = normalizeLookupKey(value)
  return key === 'blank' || key === '无动物'
}

function normalizeCsvPath(rawPath) {
  const normalized = String(rawPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.xmp$/i, '')

  return path.normalize(normalized)
}

function parseServalTimestamp(rawTimestamp) {
  const value = cleanCell(rawTimestamp)
  if (!value) return null

  let dt = DateTime.fromFormat(value, 'yyyy-MM-dd HH:mm:ss')
  if (dt.isValid) return dt

  dt = DateTime.fromFormat(value, 'yyyy-MM-dd HH:ss:mm')
  return dt.isValid ? dt : null
}

async function insertInBatches(db, table, rows, batchSize = 500) {
  if (!rows || rows.length === 0) return
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    await db.insert(table).values(batch)
  }
}

function addAlias(aliasMap, key, value) {
  const normalized = normalizeLookupKey(key)
  if (normalized) aliasMap.set(normalized, value)
}

function unresolvedTaxon(rawLabel) {
  const sourceLabel = cleanCell(rawLabel)
  return {
    matched: false,
    blank: false,
    scientificName: normalizeScientificName(sourceLabel),
    commonName: null,
    sourceLabel
  }
}

export function buildServalTaxonomyResolver(rows) {
  const aliasMap = new Map()

  for (const row of rows || []) {
    const tag = cleanCell(row.tag)
    const scientificName = cleanCell(row.mazeScientificName)
    const chineseName = cleanCell(row.mazeNameCN)
    const isBlank =
      isBlankTaxonValue(tag) || isBlankTaxonValue(scientificName) || isBlankTaxonValue(chineseName)

    if (!tag || !scientificName || !chineseName) continue

    const resolved = isBlank
      ? {
          matched: true,
          blank: true,
          scientificName: null,
          commonName: null,
          sourceLabel: tag
        }
      : {
          matched: true,
          blank: false,
          scientificName: normalizeScientificName(scientificName),
          commonName: resolveCommonName(scientificName),
          sourceLabel: tag
        }

    addAlias(aliasMap, tag, resolved)
    addAlias(aliasMap, scientificName, resolved)
    addAlias(aliasMap, chineseName, resolved)
  }

  return {
    resolve(rawLabel) {
      const key = normalizeLookupKey(rawLabel)
      if (!key) return unresolvedTaxon(rawLabel)

      const resolved = aliasMap.get(key)
      if (resolved) return { ...resolved }

      if (isBlankTaxonValue(rawLabel)) {
        return {
          matched: false,
          blank: true,
          scientificName: null,
          commonName: null,
          sourceLabel: cleanCell(rawLabel)
        }
      }

      return unresolvedTaxon(rawLabel)
    }
  }
}

async function readCsvRows(csvPath) {
  return new Promise((resolve, reject) => {
    const rows = []
    fs.createReadStream(csvPath)
      .pipe(
        csv({
          mapHeaders: ({ header }) => cleanCell(header)
        })
      )
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject)
  })
}

async function readServalTaxonomy(taglistPath) {
  const rows = await readCsvRows(taglistPath)
  return buildServalTaxonomyResolver(rows)
}

function candidateBundledTaglistPaths() {
  const candidates = [path.join(PROJECT_ROOT, BUNDLED_TAGLIST_RELATIVE_PATH)]

  if (process.resourcesPath) {
    candidates.push(
      path.join(process.resourcesPath, 'taxonomy', 'serval-taglist.csv'),
      path.join(process.resourcesPath, BUNDLED_TAGLIST_RELATIVE_PATH),
      path.join(process.resourcesPath, 'app.asar.unpacked', BUNDLED_TAGLIST_RELATIVE_PATH)
    )
  }

  return candidates
}

export function findServalTaglistPath(tagsCsvPath) {
  const tagsDir = path.dirname(tagsCsvPath)
  const sidecarCandidates = [
    path.join(tagsDir, 'serval-taglist.csv'),
    path.join(tagsDir, 'taglist.csv'),
    path.join(tagsDir, 'maze_taglist.completed.csv'),
    path.join(tagsDir, 'maze_taglist.csv')
  ]

  for (const candidate of [...sidecarCandidates, ...candidateBundledTaglistPaths()]) {
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

function getEventId(row) {
  return cleanCell(row.event_id || row.eventID || row.eventId)
}

async function readServalRows(csvPath, taxonomyResolver) {
  const csvRows = await readCsvRows(csvPath)
  const parsedRows = []
  const unresolvedLabels = new Set()

  for (const row of csvRows) {
    const filePath = normalizeCsvPath(row.path)
    const deployment = cleanCell(row.deployment)
    const timestamp = parseServalTimestamp(row.time)
    const speciesLabel = cleanCell(row.species)
    const eventID = getEventId(row)

    if (!filePath || !deployment || !timestamp || !speciesLabel) continue

    const taxon = taxonomyResolver.resolve(speciesLabel)
    if (!taxon.matched && !taxon.blank) unresolvedLabels.add(speciesLabel)

    parsedRows.push({
      filePath,
      deployment,
      timestamp,
      speciesLabel,
      eventID,
      taxon
    })
  }

  return { rows: parsedRows, unresolvedLabels: [...unresolvedLabels] }
}

export async function importServalDataset(csvPath, id) {
  const biowatchDataPath = getBiowatchDataPath()
  return await importServalDatasetWithPath(csvPath, biowatchDataPath, id)
}

export async function importServalDatasetWithPath(csvPath, biowatchDataPath, id) {
  log.info('Starting Serval CSV dataset import')

  const taglistPath = findServalTaglistPath(csvPath)
  if (!taglistPath) {
    throw new Error('Serval taglist not found. Place serval-taglist.csv next to tags.csv.')
  }

  const taxonomyResolver = await readServalTaxonomy(taglistPath)
  const { rows, unresolvedLabels } = await readServalRows(csvPath, taxonomyResolver)

  if (unresolvedLabels.length > 0) {
    log.warn(`Serval unresolved labels: ${unresolvedLabels.join(', ')}`)
  }

  const dbPath = path.join(biowatchDataPath, 'studies', id, 'study.db')
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const db = await getDrizzleDb(id, dbPath)
  const csvFileName = path.basename(csvPath, path.extname(csvPath))

  const metadataRecord = {
    id,
    name: csvFileName,
    title: null,
    description: null,
    created: new Date().toISOString(),
    importerName: 'serval/csv',
    contributors: null,
    sequenceGap: null
  }

  try {
    await insertMetadata(db, metadataRecord)
    log.info('Inserted study metadata into database')

    if (rows.length === 0) {
      log.warn('Serval CSV contains no valid rows')
      return { data: metadataRecord }
    }

    const deploymentByLocation = new Map()
    const deploymentRows = []
    for (const row of rows) {
      if (deploymentByLocation.has(row.deployment)) continue
      const deploymentID = crypto.randomUUID()
      deploymentByLocation.set(row.deployment, deploymentID)
      deploymentRows.push({
        deploymentID,
        locationID: row.deployment,
        locationName: row.deployment,
        deploymentStart: null,
        deploymentEnd: null,
        latitude: null,
        longitude: null
      })
    }
    await insertInBatches(db, deployments, deploymentRows)
    log.info(`Inserted ${deploymentRows.length} deployment rows from Serval CSV`)

    const mediaByKey = new Map()
    const mediaRows = []
    const observationRows = []
    const deploymentTimestamps = new Map()
    const classificationTimestamp = new Date().toISOString()

    for (const row of rows) {
      const deploymentID = deploymentByLocation.get(row.deployment)
      if (!deploymentID) continue

      const mediaKey = `${deploymentID}::${row.filePath}`
      let mediaID = mediaByKey.get(mediaKey)

      if (!mediaID) {
        mediaID = crypto.randomUUID()
        mediaByKey.set(mediaKey, mediaID)
        mediaRows.push({
          mediaID,
          deploymentID,
          timestamp: row.timestamp.toISO(),
          filePath: row.filePath,
          fileName: path.basename(row.filePath)
        })

        if (!deploymentTimestamps.has(deploymentID)) {
          deploymentTimestamps.set(deploymentID, [])
        }
        deploymentTimestamps.get(deploymentID).push(row.timestamp)
      }

      const observationType = row.taxon.blank
        ? 'blank'
        : row.taxon.scientificName === 'homo sapiens'
          ? 'human'
          : 'animal'

      observationRows.push({
        observationID: crypto.randomUUID(),
        mediaID,
        deploymentID,
        eventID: row.eventID || null,
        eventStart: row.timestamp.toISO(),
        eventEnd: row.timestamp.toISO(),
        scientificName: row.taxon.scientificName,
        observationType,
        commonName: row.taxon.commonName,
        classificationProbability: null,
        count: row.taxon.blank ? 0 : 1,
        lifeStage: null,
        age: null,
        sex: null,
        behavior: null,
        classificationMethod: 'machine',
        classifiedBy: 'Serval',
        classificationTimestamp
      })
    }

    if (mediaRows.length > 0) {
      await insertInBatches(db, media, mediaRows)
      log.info(`Inserted ${mediaRows.length} media rows from Serval CSV`)
    }

    if (observationRows.length > 0) {
      await insertInBatches(db, observations, observationRows)
      log.info(`Inserted ${observationRows.length} observation rows from Serval CSV`)
    }

    for (const [deploymentID, timestamps] of deploymentTimestamps.entries()) {
      if (!timestamps || timestamps.length === 0) continue
      const sorted = timestamps.sort((a, b) => a.toMillis() - b.toMillis())
      await db
        .update(deployments)
        .set({
          deploymentStart: sorted[0].toISO(),
          deploymentEnd: sorted[sorted.length - 1].toISO()
        })
        .where(eq(deployments.deploymentID, deploymentID))
    }

    log.info('Serval CSV import completed successfully')
    return { data: metadataRecord }
  } catch (error) {
    log.error('Error importing Serval CSV dataset:', error)
    throw error
  } finally {
    await closeStudyDatabase(id)
  }
}
