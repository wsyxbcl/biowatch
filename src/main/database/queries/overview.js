/**
 * Overview tab — consolidated stats query.
 * Returns one payload covering every KPI tile shown on the Overview tab,
 * including the derived date range used by the Span tile.
 */

import { getDrizzleDb, getStudyDatabase, media, observations } from '../index.js'
import { and, isNotNull, ne, sql, count } from 'drizzle-orm'
import log from 'electron-log'
import { getStudyIdFromPath } from './utils.js'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/resolver.js'

const THREATENED_IUCN = new Set(['VU', 'EN', 'CR', 'EW', 'EX'])

/**
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<{
 *   speciesCount: number,
 *   threatenedCount: number,
 *   cameraCount: number,
 *   locationCount: number,
 *   observationCount: number,
 *   cameraDays: number,
 *   mediaCount: number,
 *   derivedRange: { start: string | null, end: string | null }
 * }>}
 */
export async function getOverviewStats(dbPath) {
  const startTime = Date.now()
  log.info(`Querying overview stats from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })
    const manager = await getStudyDatabase(studyId, dbPath, { readonly: true })
    const sqlite = manager.getSqlite()

    // 1. Distinct species set (excluding blanks/nulls/empty strings)
    const speciesRows = await db
      .select({ scientificName: observations.scientificName })
      .from(observations)
      .where(
        and(
          isNotNull(observations.scientificName),
          ne(observations.scientificName, ''),
          sql`(${observations.observationType} IS NULL OR ${observations.observationType} != 'blank')`
        )
      )
      .groupBy(observations.scientificName)

    const speciesCount = speciesRows.length
    const threatenedCount = speciesRows.reduce((acc, row) => {
      const info = resolveSpeciesInfo(row.scientificName)
      return acc + (info?.iucn && THREATENED_IUCN.has(info.iucn) ? 1 : 0)
    }, 0)

    // 2. Camera + location counts.
    //    Cameras: distinct cameraID, COALESCEing to deploymentID for rows
    //    where cameraID is null (common — many importers don't populate it).
    //    Each deployment contributes at minimum one camera-station event, so
    //    falling back to deploymentID gives a sensible non-zero number.
    const cameraCountRow = sqlite
      .prepare(
        `SELECT COUNT(DISTINCT COALESCE(cameraID, deploymentID)) AS n FROM deployments`
      )
      .get()
    const cameraCount = cameraCountRow?.n ?? 0

    const locationCountRow = sqlite
      .prepare(
        `SELECT COUNT(DISTINCT locationID) AS n FROM deployments WHERE locationID IS NOT NULL`
      )
      .get()
    const locationCount = locationCountRow?.n ?? 0

    // 3. Observation count (excluding blanks)
    const obsResult = await db
      .select({ n: count().as('n') })
      .from(observations)
      .where(
        sql`(${observations.observationType} IS NULL OR ${observations.observationType} != 'blank')`
      )
      .get()
    const observationCount = obsResult?.n ?? 0

    // 4. Camera-days: SUM(julianday(end) - julianday(start)) over deployments
    //    that have both fields set. Round to nearest integer day.
    const cameraDaysRow = sqlite
      .prepare(
        `SELECT COALESCE(
           SUM(julianday(deploymentEnd) - julianday(deploymentStart)),
           0
         ) AS days
         FROM deployments
         WHERE deploymentStart IS NOT NULL
           AND deploymentEnd IS NOT NULL
           AND julianday(deploymentEnd) IS NOT NULL
           AND julianday(deploymentStart) IS NOT NULL`
      )
      .get()
    const cameraDays = Math.round(cameraDaysRow?.days || 0)

    // 5. Media count
    const mediaResult = await db.select({ n: count().as('n') }).from(media).get()
    const mediaCount = mediaResult?.n ?? 0

    // 6. Derived range
    const derivedRange = deriveRange(sqlite)

    const elapsedTime = Date.now() - startTime
    log.info(
      `Overview stats: ${speciesCount} species, ${observationCount} obs, ${mediaCount} media in ${elapsedTime}ms`
    )

    return {
      speciesCount,
      threatenedCount,
      cameraCount,
      locationCount,
      observationCount,
      cameraDays,
      mediaCount,
      derivedRange
    }
  } catch (error) {
    log.error(`Error in getOverviewStats: ${error.message}`)
    throw error
  }
}

/**
 * Resolve start and end independently using the override → observations →
 * deployments → media chain. Returns ISO date strings (YYYY-MM-DD) or null.
 */
function deriveRange(sqlite) {
  // Override (metadata.startDate / endDate). The metadata row may not exist
  // for very fresh studies; tolerate undefined.
  const meta = sqlite.prepare('SELECT startDate, endDate FROM metadata LIMIT 1').get()
  const overrideStart = meta?.startDate || null
  const overrideEnd = meta?.endDate || null

  // Observations
  const obs = sqlite
    .prepare(
      `SELECT MIN(eventStart) AS minE, MAX(eventStart) AS maxE
         FROM observations
         WHERE eventStart IS NOT NULL AND eventStart != ''`
    )
    .get()

  // Deployments — start uses deploymentStart, end uses deploymentEnd
  const dep = sqlite
    .prepare(
      `SELECT
         MIN(CASE WHEN deploymentStart IS NOT NULL AND deploymentStart != '' THEN deploymentStart END) AS minS,
         MAX(CASE WHEN deploymentEnd   IS NOT NULL AND deploymentEnd   != '' THEN deploymentEnd   END) AS maxE
         FROM deployments`
    )
    .get()

  // Media timestamps
  const med = sqlite
    .prepare(
      `SELECT MIN(timestamp) AS minT, MAX(timestamp) AS maxT
         FROM media
         WHERE timestamp IS NOT NULL AND timestamp != ''`
    )
    .get()

  const startSources = [overrideStart, obs?.minE, dep?.minS, med?.minT]
  const endSources = [overrideEnd, obs?.maxE, dep?.maxE, med?.maxT]

  return {
    start: toIsoDate(startSources.find((v) => !!v)),
    end: toIsoDate(endSources.find((v) => !!v))
  }
}

function toIsoDate(value) {
  if (!value) return null
  // value can be 'YYYY-MM-DD' or full ISO 'YYYY-MM-DDTHH:MM:SSZ'.
  // Take the first 10 characters either way.
  return String(value).slice(0, 10)
}
