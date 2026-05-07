import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'

/**
 * Stream media.csv and observations.csv from a CamTrap-DP directory, finding
 * deploymentID values that reference rows missing from deployments.csv. Used
 * by the importer to synthesize stub deployments before the FK-enforced media
 * insert runs.
 *
 * @param {Object} args
 * @param {string} args.directoryPath - Path to the CamTrap-DP directory.
 * @param {Set<string>} args.knownDeploymentIDs - IDs already inserted from deployments.csv.
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<Map<string, { start: string|null, end: string|null, mediaCount: number, obsCount: number }>>}
 */
export async function collectOrphanDeployments({ directoryPath, knownDeploymentIDs, signal }) {
  const orphans = new Map()

  await scanCsv({
    filePath: path.join(directoryPath, 'media.csv'),
    signal,
    onRow: (row) => {
      const id = row.deploymentID
      if (!id || knownDeploymentIDs.has(id)) return
      const entry = getOrCreate(orphans, id)
      entry.mediaCount += 1
      const ts = row.timestamp
      if (ts) {
        if (entry.start === null || ts < entry.start) entry.start = ts
        if (entry.end === null || ts > entry.end) entry.end = ts
      }
    }
  })

  await scanCsv({
    filePath: path.join(directoryPath, 'observations.csv'),
    signal,
    onRow: (row) => {
      const id = row.deploymentID
      if (!id || knownDeploymentIDs.has(id)) return
      const entry = getOrCreate(orphans, id)
      entry.obsCount += 1
      const start = row.eventStart
      const end = row.eventEnd
      if (start) {
        if (entry.start === null || start < entry.start) entry.start = start
        if (entry.end === null || start > entry.end) entry.end = start
      }
      if (end) {
        if (entry.start === null || end < entry.start) entry.start = end
        if (entry.end === null || end > entry.end) entry.end = end
      }
    }
  })

  return orphans
}

function getOrCreate(map, id) {
  let entry = map.get(id)
  if (!entry) {
    entry = { start: null, end: null, mediaCount: 0, obsCount: 0 }
    map.set(id, entry)
  }
  return entry
}

async function scanCsv({ filePath, signal, onRow }) {
  if (signal?.aborted) {
    throw new DOMException('Import cancelled', 'AbortError')
  }
  if (!fs.existsSync(filePath)) return

  const stream = fs.createReadStream(filePath).pipe(csv())
  const onAbort = () => stream.destroy(new DOMException('Import cancelled', 'AbortError'))
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const row of stream) {
      if (signal?.aborted) {
        throw new DOMException('Import cancelled', 'AbortError')
      }
      onRow(row)
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
