import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatStatNumber,
  formatSpan,
  formatRangeShort
} from '../../../src/renderer/src/overview/utils/formatStats.js'

describe('formatStatNumber', () => {
  test('returns em-dash for null / undefined / NaN', () => {
    assert.equal(formatStatNumber(null), '—')
    assert.equal(formatStatNumber(undefined), '—')
    assert.equal(formatStatNumber(NaN), '—')
  })

  test('preserves small numbers with locale separators', () => {
    assert.equal(formatStatNumber(0), '0')
    assert.equal(formatStatNumber(47), '47')
    assert.equal(formatStatNumber(999), '999')
    assert.equal(formatStatNumber(1234), '1,234')
    assert.equal(formatStatNumber(9999), '9,999')
  })

  test('compacts to K above 9,999', () => {
    assert.equal(formatStatNumber(10000), '10K')
    assert.equal(formatStatNumber(12453), '12.5K')
    assert.equal(formatStatNumber(999999), '1M')
  })

  test('compacts to M above 999,999', () => {
    assert.equal(formatStatNumber(1234567), '1.2M')
    assert.equal(formatStatNumber(12_345_678), '12.3M')
  })
})

describe('formatSpan', () => {
  test('returns em-dash for null/missing inputs', () => {
    assert.equal(formatSpan(null, '2024-01-01'), '—')
    assert.equal(formatSpan('2024-01-01', null), '—')
    assert.equal(formatSpan(null, null), '—')
  })

  test('full year span returns "<N> yr"', () => {
    assert.equal(formatSpan('2020-01-01', '2024-12-31'), '5 yr')
    assert.equal(formatSpan('2023-04-01', '2024-04-01'), '1 yr')
  })

  test('sub-year spans return "<N> mo"', () => {
    assert.equal(formatSpan('2024-01-01', '2024-04-01'), '3 mo')
    assert.equal(formatSpan('2024-06-01', '2024-12-15'), '6 mo')
  })

  test('zero-length range', () => {
    assert.equal(formatSpan('2024-01-01', '2024-01-01'), '0 mo')
  })
})

describe('formatRangeShort', () => {
  test('returns null for missing inputs', () => {
    assert.equal(formatRangeShort(null, '2024-01-01'), null)
    assert.equal(formatRangeShort('2024-01-01', null), null)
  })

  test('formats as "MMM \'YY – MMM \'YY"', () => {
    // Use a regex to allow the U+2013 EN DASH (–) the formatter emits.
    const result = formatRangeShort('2020-01-15', '2024-12-15')
    assert.match(result, /^Jan '20\s–\sDec '24$/)
  })
})
