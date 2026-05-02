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
