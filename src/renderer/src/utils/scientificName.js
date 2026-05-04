/**
 * Normalize a scientific (Latin binomial) name for display: lowercase the
 * entire string, then capitalize the first letter only. Per ICZN/ICNafp:
 * genus is capitalized, species/subspecies epithets are lowercase. Idempotent.
 *
 *   "PANTHERA LEO"       -> "Panthera leo"
 *   "panthera leo"       -> "Panthera leo"
 *   "Panthera Leo"       -> "Panthera leo"
 *   "Panthera leo persica" -> "Panthera leo persica"
 *   "Panthera sp."       -> "Panthera sp."
 *
 * Returns the input unchanged if it is null/undefined or not a string.
 *
 * @param {string | null | undefined} name
 * @returns {string | null | undefined}
 */
export function formatScientificName(name) {
  if (typeof name !== 'string' || name.length === 0) return name
  const lower = name.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}
