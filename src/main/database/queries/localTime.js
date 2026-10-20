/**
 * Local wall-clock time of a stored timestamp, as SQL.
 *
 * Timestamps are stored as ISO 8601 strings in mixed forms: photo EXIF with an
 * offset ("2026-06-28T00:27:48.000+08:00"), video/filename times as UTC
 * ("...Z"), and some imports without a zone. SQLite's date functions convert
 * zoned strings to UTC, so strftime('%H', ts) returned UTC hours and
 * substr(ts, 1, 10) mixed local and UTC dates.
 *
 * maze: zoned timestamps are converted to the machine's local time (our users'
 * cameras and computers share a timezone); zone-less ones are already local
 * wall-clock time and are left as they are.
 */

import { sql } from 'drizzle-orm'

const ZONED = (col) => `(${col} GLOB '*[Zz]' OR ${col} GLOB '*[+-][0-9][0-9]:[0-9][0-9]')`

/**
 * @param {string} col - SQL column expression, e.g. "m.timestamp"
 * @returns {string} SQL expression yielding local "YYYY-MM-DD HH:MM:SS"
 */
export function localTimeSql(col) {
  return `(CASE WHEN ${ZONED(col)} THEN datetime(${col}, 'localtime') ELSE ${col} END)`
}

/** SQL integer hour (0-23) of the local wall-clock time. */
export function localHourSql(col) {
  return `CAST(strftime('%H', ${localTimeSql(col)}) AS INTEGER)`
}

/** SQL date of the Sunday-started week containing the local date (as before: 'weekday 0', '-7 days'). */
export function localWeekStartSql(col) {
  return `date(${localTimeSql(col)}, 'weekday 0', '-7 days')`
}

// Drizzle variants: interpolate the column object so drizzle renders its name.
const localTimeFragment = (column) =>
  sql`(CASE WHEN (${column} GLOB '*[Zz]' OR ${column} GLOB '*[+-][0-9][0-9]:[0-9][0-9]') THEN datetime(${column}, 'localtime') ELSE ${column} END)`

/** Drizzle SQL integer hour (0-23) of the local wall-clock time. */
export const localHour = (column) =>
  sql`CAST(strftime('%H', ${localTimeFragment(column)}) AS INTEGER)`

/** Drizzle SQL Sunday-started week start of the local date. */
export const localWeekStart = (column) =>
  sql`date(${localTimeFragment(column)}, 'weekday 0', '-7 days')`
