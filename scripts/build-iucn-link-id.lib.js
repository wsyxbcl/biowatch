const THREATENED = new Set(['Vulnerable', 'Endangered', 'Critically Endangered'])

/**
 * Extract the four fields we keep from a single assessments.csv row.
 * Returns null for rows we don't care about (non-threatened categories,
 * malformed scientific name, unparseable IDs).
 *
 * @param {Record<string,string>} row
 * @returns {{ name: string, taxonId: number, assessmentId: number, year: number } | null}
 */
export function parseRedlistRow(row) {
  if (!row) return null
  if (!THREATENED.has(row.redlistCategory)) return null

  const name = typeof row.scientificName === 'string' ? row.scientificName.trim().toLowerCase() : ''
  if (!name) return null

  const taxonId = Number.parseInt(row.internalTaxonId, 10)
  const assessmentId = Number.parseInt(row.assessmentId, 10)
  const year = Number.parseInt(row.yearPublished, 10)
  if (!Number.isFinite(taxonId) || !Number.isFinite(assessmentId)) return null

  return { name, taxonId, assessmentId, year: Number.isFinite(year) ? year : 0 }
}

/**
 * Collapse a stream of parsed rows into a map of name -> latest entry.
 * When multiple rows share a name, the one with the highest `year` wins.
 *
 * @param {Array<{name:string,taxonId:number,assessmentId:number,year:number}>} rows
 * @returns {Map<string,{name:string,taxonId:number,assessmentId:number,year:number}>}
 */
export function pickLatestPerTaxon(rows) {
  const out = new Map()
  for (const row of rows) {
    const prev = out.get(row.name)
    if (!prev || row.year > prev.year) out.set(row.name, row)
  }
  return out
}

/**
 * Try to extract a Red List version tag (e.g. "2025-1") from the export
 * folder's name; fall back to the folder's mtime as an ISO date.
 *
 * IUCN bulk-export folders are typically uuid-suffixed
 * (`redlist_species_data_<uuid>`), so the version tag is usually absent and
 * we end up with the date fallback. Pass `--version` on the CLI to override
 * with the actual Red List version (e.g. `2025-1`).
 *
 * The regex requires a 4-digit year followed by `-` followed by 1-2 digits.
 * It anchors on non-alphanumeric / non-dash characters on both sides so it
 * doesn't false-match inside the hex chunks of a uuid (where letters break
 * the digit run anyway, but cheap defense in depth).
 *
 * @param {{ name: string, mtime: number }} folder
 * @returns {string}
 */
export function inferSourceVersion(folder) {
  const m = folder.name.match(/(?:^|[^0-9a-zA-Z-])(\d{4}-\d{1,2})(?=[^0-9a-zA-Z-]|$)/)
  if (m) return m[1]
  return new Date(folder.mtime).toISOString().slice(0, 10)
}

const THREATENED_CODES = new Set(['VU', 'EN', 'CR'])

/**
 * Merge IUCN public IDs into the data.json species map.
 *
 * - Only VU/EN/CR entries are eligible for IUCN ID enrichment.
 * - For each eligible entry, try a direct binomial match first, then the
 *   alias map (label -> binomial).
 * - When matched, set both `iucnTaxonId` and `iucnAssessmentId`.
 * - When unmatched, strip both fields (so reruns after a removal upstream
 *   are idempotent and never leave stale IDs behind).
 * - Two top-level metadata keys (`_iucnSourceVersion`, `_iucnRefreshedAt`)
 *   are written each run.
 *
 * Pure function — does no I/O. Returns a new object; does not mutate input.
 *
 * @param {Record<string, object>} data    existing data.json map (may include _iucn* keys)
 * @param {Map<string, {taxonId:number, assessmentId:number}>} ids
 *   binomial -> ID map (typically the output of pickLatestPerTaxon)
 * @param {Map<string, string>} aliases    label -> binomial alias map
 * @param {{ sourceVersion: string, refreshedAt: string }} meta
 * @returns {Record<string, object>}
 */
export function mergeIdsIntoSpeciesData(data, ids, aliases, meta) {
  const out = {
    _iucnSourceVersion: meta.sourceVersion,
    _iucnRefreshedAt: meta.refreshedAt
  }
  for (const [key, entry] of Object.entries(data)) {
    if (key.startsWith('_')) continue // skip prior metadata; we rewrote it above
    if (!THREATENED_CODES.has(entry?.iucn)) {
      out[key] = entry
      continue
    }

    const direct = ids.get(key)
    const aliased = !direct && aliases.has(key) ? ids.get(aliases.get(key)) : null
    const match = direct || aliased

    if (match) {
      out[key] = { ...entry, iucnTaxonId: match.taxonId, iucnAssessmentId: match.assessmentId }
    } else {
      // Strip stale IDs so reruns stay idempotent after a name is removed
      // from the IUCN export.
      const next = { ...entry }
      delete next.iucnTaxonId
      delete next.iucnAssessmentId
      out[key] = next
    }
  }
  return out
}
