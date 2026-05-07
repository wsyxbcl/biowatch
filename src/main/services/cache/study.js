/**
 * Per-study cache stats and clearing.
 *
 * Aggregates disk usage across the four known cache subdirectories
 * (transcodes, thumbnails, images, videos) under
 * <userData>/biowatch-data/studies/<studyId>/cache/, and clears the
 * whole cache directory in one call. Pure *Impl variants take the
 * studies root as a parameter so they are testable without Electron.
 */

import { readdir, stat, rm } from 'fs/promises'
import { join } from 'path'

import { getBiowatchDataPath } from '../paths.js'

const KNOWN_SUBTYPES = ['transcodes', 'thumbnails', 'images', 'videos']

/**
 * Recursively sum bytes and file count under a directory.
 * Missing dir → zeros, no throw. Unreadable entry → skipped.
 *
 * @param {string} dir
 * @returns {Promise<{ bytes: number, files: number }>}
 */
async function dirStats(dir) {
  let bytes = 0
  let files = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return { bytes: 0, files: 0 }
    return { bytes: 0, files: 0 }
  }
  await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          const sub = await dirStats(full)
          bytes += sub.bytes
          files += sub.files
        } else if (entry.isFile()) {
          const st = await stat(full)
          bytes += st.size
          files += 1
        }
      } catch {
        // unreadable — skip
      }
    })
  )
  return { bytes, files }
}

/**
 * Pure variant — testable without Electron.
 *
 * @param {string} studiesPath - absolute path to <biowatch-data>/studies
 * @param {string} studyId
 * @returns {Promise<{
 *   total: { bytes: number, files: number },
 *   breakdown: {
 *     transcodes: { bytes: number, files: number },
 *     thumbnails: { bytes: number, files: number },
 *     images:     { bytes: number, files: number },
 *     videos:     { bytes: number, files: number }
 *   }
 * }>}
 */
export async function getStudyCacheStatsImpl(studiesPath, studyId) {
  const cacheDir = join(studiesPath, studyId, 'cache')

  const breakdown = {
    transcodes: { bytes: 0, files: 0 },
    thumbnails: { bytes: 0, files: 0 },
    images: { bytes: 0, files: 0 },
    videos: { bytes: 0, files: 0 }
  }

  let entries
  try {
    entries = await readdir(cacheDir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { total: { bytes: 0, files: 0 }, breakdown }
    }
    throw err
  }

  const total = await dirStats(cacheDir)

  await Promise.all(
    KNOWN_SUBTYPES.map(async (name) => {
      const sub = entries.find((e) => e.isDirectory() && e.name === name)
      if (!sub) return
      breakdown[name] = await dirStats(join(cacheDir, name))
    })
  )

  return { total, breakdown }
}

/**
 * Pure variant — testable without Electron.
 *
 * @param {string} studiesPath
 * @param {string} studyId
 * @returns {Promise<{ freedBytes: number, clearedFiles: number, error?: string }>}
 */
export async function clearStudyCacheImpl(studiesPath, studyId) {
  const cacheDir = join(studiesPath, studyId, 'cache')

  const { total } = await getStudyCacheStatsImpl(studiesPath, studyId)

  if (total.files === 0 && total.bytes === 0) {
    return { freedBytes: 0, clearedFiles: 0 }
  }

  try {
    await rm(cacheDir, { recursive: true, force: true })
    return { freedBytes: total.bytes, clearedFiles: total.files }
  } catch (e) {
    return { freedBytes: 0, clearedFiles: 0, error: e.message }
  }
}

/**
 * Electron-aware wrapper. Resolves the studies root via getBiowatchDataPath().
 */
export async function getStudyCacheStats(studyId) {
  const studiesPath = join(getBiowatchDataPath(), 'studies')
  return await getStudyCacheStatsImpl(studiesPath, studyId)
}

/**
 * Electron-aware wrapper. Resolves the studies root via getBiowatchDataPath().
 */
export async function clearStudyCache(studyId) {
  const studiesPath = join(getBiowatchDataPath(), 'studies')
  return await clearStudyCacheImpl(studiesPath, studyId)
}
