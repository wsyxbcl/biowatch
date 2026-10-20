import { useQuery } from '@tanstack/react-query'
import { resolveCommonName, pickEnglishCommonName } from '../../../shared/commonNames/index.js'

/**
 * Synchronous version of the common-name cascade for contexts that can't run
 * hooks (e.g. renderToStaticMarkup): study-imported vernacular →
 * shipped dictionary → null. Skips the GBIF async tier.
 *
 * @param {string | null | undefined} scientificName
 * @param {Record<string, string> | undefined} scientificToCommon
 * @returns {string | null}
 */
export function getMapDisplayName(scientificName, scientificToCommon) {
  if (!scientificName) return null
  return scientificToCommon?.[scientificName] || resolveDisplayCommonName(scientificName) || null
}

// Vernacular names supplied by the open study (its CamtrapDP `taxonomic`
// block, or names contributed by the models that ran on it). Set by the study
// page before its children render; empty outside a study.
let studyCommonNames = {}

/** @param {Record<string, string> | null | undefined} map */
export function setStudyCommonNames(map) {
  studyCommonNames = map || {}
}

/**
 * Synchronous display name: the open study's vernacular name, else the shipped
 * dictionary. Scientific names and the dictionary itself are unchanged.
 *
 * @param {string | null | undefined} scientificName
 * @returns {string | null}
 */
export function resolveDisplayCommonName(scientificName) {
  if (!scientificName) return null
  return studyCommonNames[scientificName] || resolveCommonName(scientificName)
}

/**
 * Build a `scientificName -> vernacular` map from a CamtrapDP-style
 * taxonomic block, taking the first available of `languages` (ISO 639-3). Defensive against null/non-array input and taxa missing
 * either field. Used by both the Explore map and the species sidebar so the
 * two surfaces stay in sync.
 *
 * @param {Array<{scientificName?: string, vernacularNames?: {eng?: string}}> | null | undefined} taxonomicData
 * @param {{ languages?: string[] }} [options]
 * @returns {Record<string, string>}
 */
export function buildScientificToCommonMap(taxonomicData, { languages = ['eng'] } = {}) {
  const map = {}
  if (!Array.isArray(taxonomicData)) return map
  for (const taxon of taxonomicData) {
    const name = languages.map((lang) => taxon?.vernacularNames?.[lang]).find(Boolean)
    if (taxon?.scientificName && name) map[taxon.scientificName] = name
  }
  return map
}

// In-memory cache + fetcher live inside a closure — the cache isn't reachable
// from outside the IIFE, only the exported functions are. Avoids module-level
// mutable state bleeding through the import surface.
const { fetchGbifCommonName, _clearGbifCache } = (() => {
  const cache = new Map()

  async function fetchGbifCommonName(scientificName) {
    if (cache.has(scientificName)) return cache.get(scientificName)

    const matchRes = await fetch(
      `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`
    )
    const matchData = await matchRes.json()
    if (!matchData.usageKey) {
      cache.set(scientificName, null)
      return null
    }

    const vernRes = await fetch(
      `https://api.gbif.org/v1/species/${matchData.usageKey}/vernacularNames`
    )
    const vernData = await vernRes.json()
    const picked = pickEnglishCommonName(vernData?.results ?? null)
    cache.set(scientificName, picked)
    return picked
  }

  return {
    fetchGbifCommonName,
    _clearGbifCache: () => cache.clear()
  }
})()

/**
 * Fetch a scored English common name for `scientificName` from GBIF.
 * Results (including null) are memoized in a closure-scoped Map to prevent
 * duplicate network calls within a session.
 *
 * Pure enough to unit-test: mock `global.fetch` and call it directly.
 *
 * @param {string} scientificName
 * @returns {Promise<string | null>}
 */
export { fetchGbifCommonName }

/** Test-only: reset the in-memory cache between test cases. */
export { _clearGbifCache }

/**
 * Resolve a display common name via the cascade:
 *   0. The open study's vernacular names (see setStudyCommonNames).
 *   1. storedCommonName (authoritative from DB).
 *   2. Shipped dictionary (synchronous).
 *   3. GBIF fallback via TanStack Query (in-memory cached, scored).
 *   4. Scientific name (ultimate fallback — returned from the caller, not here).
 *
 * Returns the resolved name, or null if scientificName is null/empty.
 * While the GBIF call is pending, returns the dictionary hit (null) — the
 * caller should display `scientificName` as the during-fetch placeholder.
 *
 * @param {string | null | undefined} scientificName
 * @param {{ storedCommonName?: string | null }} options
 * @returns {string | null}
 */
export function useCommonName(scientificName, { storedCommonName } = {}) {
  const studyName = (scientificName && studyCommonNames[scientificName]) || null
  const stored =
    !studyName && typeof storedCommonName === 'string' && storedCommonName.trim() !== ''
      ? storedCommonName
      : null

  const dictHit = studyName || stored ? null : resolveCommonName(scientificName)

  const { data: gbifResult } = useQuery({
    queryKey: ['gbifCommonName', scientificName],
    queryFn: () => fetchGbifCommonName(scientificName),
    enabled: !!scientificName && !studyName && !stored && !dictHit,
    staleTime: Infinity,
    retry: 1
  })

  if (studyName) return studyName
  if (stored) return stored
  if (dictHit) return dictHit
  if (gbifResult) return gbifResult
  return null
}
