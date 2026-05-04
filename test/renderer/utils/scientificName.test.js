import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { formatScientificName } from '../../../src/renderer/src/utils/scientificName.js'

describe('formatScientificName', () => {
  test('leaves canonical binomial unchanged', () => {
    assert.equal(formatScientificName('Panthera leo'), 'Panthera leo')
  })

  test('downcases all-caps input', () => {
    assert.equal(formatScientificName('PANTHERA LEO'), 'Panthera leo')
  })

  test('capitalizes all-lowercase input', () => {
    assert.equal(formatScientificName('panthera leo'), 'Panthera leo')
  })

  test('downcases incorrectly capitalized species epithet', () => {
    assert.equal(formatScientificName('Panthera Leo'), 'Panthera leo')
  })

  test('handles trinomial (subspecies)', () => {
    assert.equal(formatScientificName('PANTHERA LEO PERSICA'), 'Panthera leo persica')
  })

  test('preserves "sp." abbreviation in lowercase', () => {
    assert.equal(formatScientificName('Panthera sp.'), 'Panthera sp.')
    assert.equal(formatScientificName('PANTHERA SP.'), 'Panthera sp.')
  })

  test('is idempotent', () => {
    const once = formatScientificName('PANTHERA LEO')
    assert.equal(formatScientificName(once), once)
  })

  test('returns null for null', () => {
    assert.equal(formatScientificName(null), null)
  })

  test('returns undefined for undefined', () => {
    assert.equal(formatScientificName(undefined), undefined)
  })

  test('returns empty string for empty string', () => {
    assert.equal(formatScientificName(''), '')
  })

  test('returns input unchanged for non-string types', () => {
    assert.equal(formatScientificName(42), 42)
    const obj = {}
    assert.equal(formatScientificName(obj), obj)
  })
})
