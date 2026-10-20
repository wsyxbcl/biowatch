import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  localHourSql,
  localTimeSql,
  localWeekStartSql
} from '../../../../src/main/database/queries/localTime.js'

const db = new Database(':memory:')
const hour = (ts) => db.prepare(`SELECT ${localHourSql('@ts')} AS h`).get({ ts }).h
const local = (ts) => db.prepare(`SELECT ${localTimeSql('@ts')} AS t`).get({ ts }).t

test('zoned timestamps use the machine local hour, whatever the stored offset', () => {
  // Same instant three ways: photo EXIF (+08:00) and video/filename times (Z).
  for (const ts of [
    '2026-06-28T00:27:51.000+08:00',
    '2026-06-27T16:27:51.000Z',
    '2026-06-27T12:27:51-04:00'
  ]) {
    assert.equal(hour(ts), new Date(ts).getHours(), ts)
  }
})

test('zone-less timestamps keep their written wall-clock time', () => {
  assert.equal(hour('2026-06-28T00:27:51'), 0)
  assert.equal(hour('2026-06-28 23:05:00'), 23)
  assert.equal(local('2026-06-28T00:27:51'), '2026-06-28T00:27:51')
})

test('week start follows the local date', () => {
  const ts = '2026-06-27T16:27:51.000Z'
  const d = new Date(ts)
  const expected = db
    .prepare(`SELECT date(?, 'weekday 0', '-7 days') AS w`)
    .get(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    ).w
  assert.equal(db.prepare(`SELECT ${localWeekStartSql('@ts')} AS w`).get({ ts }).w, expected)
})
