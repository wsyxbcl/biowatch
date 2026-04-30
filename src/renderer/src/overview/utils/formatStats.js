/**
 * KPI band formatters. Pure, no React/DOM deps.
 */

const EM_DASH = '—'
const EN_DASH = '–'

/**
 * Format a count for a KPI tile.
 *  - null/undefined/NaN → "—"
 *  - 0..9999 → locale-formatted integer (e.g. "1,234")
 *  - 10K..999K → "12.5K" (one decimal, dropped if .0)
 *  - 1M+ → "1.2M"
 */
export function formatStatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return EM_DASH
  if (n < 10_000) return n.toLocaleString('en-US')
  if (n < 1_000_000) {
    const k = compact(n / 1000)
    // Rollover: 999_999 / 1000 = 999.999 → rounds to 1000 → would print "1000K".
    // Promote to the next bucket instead.
    if (k === '1000') return '1M'
    return k + 'K'
  }
  return compact(n / 1_000_000) + 'M'
}

function compact(value) {
  // 1 decimal, drop trailing ".0" (e.g. 10.0 → "10", 12.5 → "12.5").
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/**
 * Aggressive compact format used for sub-detail lines that need to fit on one
 * line at small widths (e.g. "from 1.1k camera-days"). Lowercase k.
 *  - null/undefined/NaN → "—"
 *  - 0..999 → locale integer
 *  - 1k..999k → "1.1k" / "950k"
 *  - 1M+    → "1.2M"
 */
export function formatCompactCount(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return EM_DASH
  if (n < 1000) return n.toLocaleString('en-US')
  if (n < 1_000_000) {
    const k = compact(n / 1000)
    if (k === '1000') return '1M'
    return k + 'k'
  }
  return compact(n / 1_000_000) + 'M'
}

/**
 * Format a date span as "<N> yr" if ≥ 12 months, else "<N> mo".
 * Both inputs are ISO date strings (YYYY-MM-DD or full ISO 8601).
 * Returns "—" if either is null/empty.
 */
export function formatSpan(startIso, endIso) {
  if (!startIso || !endIso) return EM_DASH
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return EM_DASH

  const months =
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (months >= 12) {
    const years = Math.round(months / 12)
    return `${years} yr`
  }
  return `${Math.max(0, months)} mo`
}

/**
 * Format a date range as "MMM 'YY – MMM 'YY" (en-US).
 * Returns null if either side is null — caller omits the sub-detail.
 */
export function formatRangeShort(startIso, endIso) {
  if (!startIso || !endIso) return null
  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: '2-digit'
  })
  const startStr = fmt.format(new Date(startIso)).replace(' ', " '")
  const endStr = fmt.format(new Date(endIso)).replace(' ', " '")
  return `${startStr} ${EN_DASH} ${endStr}`
}
