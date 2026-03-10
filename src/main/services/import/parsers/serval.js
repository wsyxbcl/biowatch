import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'
import crypto from 'crypto'
import { DateTime } from 'luxon'
import { eq } from 'drizzle-orm'
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

function normalizeCsvPath(rawPath) {
  const normalized = String(rawPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.xmp$/i, '')

  return path.normalize(normalized)
}

function parseServalTimestamp(rawTimestamp) {
  const value = String(rawTimestamp || '').trim()
  if (!value) return null

  // Main expected format from Serval CSV.
  let dt = DateTime.fromFormat(value, 'yyyy-MM-dd HH:mm:ss')
  if (dt.isValid) return dt

  // Fallback for occasional swapped minute/second fields.
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

/**
 * Import Serval CSV dataset into a SQLite database.
 * Expected CSV columns: path, deployment, time, species, event_id
 * @param {string} csvPath
 * @param {string} id
 * @returns {Promise<Object>}
 */
export async function importServalDataset(csvPath, id) {
  const biowatchDataPath = getBiowatchDataPath()
  return await importServalDatasetWithPath(csvPath, biowatchDataPath, id)
}

/**
 * Core Serval CSV import function with custom output root.
 * @param {string} csvPath
 * @param {string} biowatchDataPath
 * @param {string} id
 * @returns {Promise<Object>}
 */
export async function importServalDatasetWithPath(csvPath, biowatchDataPath, id) {
  log.info('Starting Serval CSV dataset import')

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
  await insertMetadata(db, metadataRecord)
  log.info('Inserted study metadata into database')

  try {
    const rows = await readServalRows(csvPath)
    if (rows.length === 0) {
      log.warn('Serval CSV contains no valid rows')
      await closeStudyDatabase(id, dbPath)
      return { data: metadataRecord }
    }

    // Build deployment map first.
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

      observationRows.push({
        observationID: crypto.randomUUID(),
        mediaID,
        deploymentID,
        eventID: row.eventID || null,
        eventStart: row.timestamp.toISO(),
        eventEnd: row.timestamp.toISO(),
        scientificName: row.species,
        observationType: null,
        commonName: row.species,
        classificationProbability: null,
        count: 1,
        prediction: row.species,
        lifeStage: null,
        age: null,
        sex: null,
        behavior: null
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

    // Fill deployment start/end from media timestamps.
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

    await closeStudyDatabase(id, dbPath)
    log.info('Serval CSV import completed successfully')
    return { data: metadataRecord }
  } catch (error) {
    log.error('Error importing Serval CSV dataset:', error)
    await closeStudyDatabase(id, dbPath)
    throw error
  }
}

async function readServalRows(csvPath) {
  return new Promise((resolve, reject) => {
    const parsedRows = []

    fs.createReadStream(csvPath)
      .pipe(
        csv({
          mapHeaders: ({ header }) =>
            String(header || '')
              .replace(/^\uFEFF/, '')
              .trim()
        })
      )
      .on('data', (row) => {
        const filePath = normalizeCsvPath(row.path)
        const deployment = String(row.deployment || '').trim()
        const timestamp = parseServalTimestamp(row.time)
        const species = String(row.species || '').trim()
        const eventID = String(row.event_id || '').trim()

        if (!filePath || !deployment || !timestamp || !species) {
          return
        }

        parsedRows.push({
          filePath,
          deployment,
          timestamp,
          species,
          eventID
        })
      })
      .on('end', () => resolve(parsedRows))
      .on('error', reject)
  })
}
