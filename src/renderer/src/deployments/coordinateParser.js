/**
 * Parse a "lat, lon" string (or "lat lon") into numbers. Returns null
 * for any input that doesn't match a valid coordinate pair.
 *
 * Used by LocationPopover's combined paste field to populate the
 * lat/lon number inputs in one keystroke (Cmd+V).
 */
export function parseCoordinates(input) {
  if (input == null || typeof input !== 'string') return null
  const match = input.trim().match(/^(-?\d+(?:\.\d+)?)[\s,]+\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return null
  const lat = parseFloat(match[1])
  const lon = parseFloat(match[2])
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null
  if (lat < -90 || lat > 90) return null
  if (lon < -180 || lon > 180) return null
  return { lat, lon }
}
