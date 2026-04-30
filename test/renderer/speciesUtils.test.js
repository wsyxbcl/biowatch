import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  isNonSpeciesLabel,
  sortSpeciesHumansLast,
  getTopNonHumanSpecies,
  BLANK_SENTINEL
} from '../../src/renderer/src/utils/speciesUtils.js'

describe('isNonSpeciesLabel', () => {
  test('returns true for the six known processing labels (case-insensitive)', () => {
    for (const label of [
      'problem',
      'blurred',
      'ignore',
      'misfire',
      'setup_pickup',
      'unclassifiable'
    ]) {
      assert.equal(isNonSpeciesLabel(label), true, `expected true for ${label}`)
      assert.equal(
        isNonSpeciesLabel(label.toUpperCase()),
        true,
        `expected true for ${label.toUpperCase()}`
      )
    }
  })

  test('trims surrounding whitespace before matching', () => {
    assert.equal(isNonSpeciesLabel('  problem  '), true)
  })

  test('returns false for real species and human/vehicle labels', () => {
    assert.equal(isNonSpeciesLabel('Vulpes vulpes'), false)
    assert.equal(isNonSpeciesLabel('Homo sapiens'), false)
    assert.equal(isNonSpeciesLabel('vehicle'), false)
  })

  test('returns false for unknown/unidentified/other labels (intentionally NOT in this tier)', () => {
    assert.equal(isNonSpeciesLabel('unknown'), false)
    assert.equal(isNonSpeciesLabel('unidentified_bird'), false)
    assert.equal(isNonSpeciesLabel('other'), false)
  })

  test('returns false for null/undefined/empty', () => {
    assert.equal(isNonSpeciesLabel(null), false)
    assert.equal(isNonSpeciesLabel(undefined), false)
    assert.equal(isNonSpeciesLabel(''), false)
  })
})

describe('sortSpeciesHumansLast — non-species tier', () => {
  test('order is: regular species → humans/vehicles → non-species labels → blank', () => {
    const data = [
      { scientificName: BLANK_SENTINEL, count: 1000 },
      { scientificName: 'problem', count: 200 },
      { scientificName: 'Homo sapiens', count: 100 },
      { scientificName: 'Vulpes vulpes', count: 50 },
      { scientificName: 'blurred', count: 10 }
    ]
    const sorted = sortSpeciesHumansLast(data).map((s) => s.scientificName)
    assert.deepEqual(sorted, [
      'Vulpes vulpes',
      'Homo sapiens',
      'problem',
      'blurred',
      BLANK_SENTINEL
    ])
  })

  test('within the non-species tier, sorts by count descending', () => {
    const data = [
      { scientificName: 'ignore', count: 5 },
      { scientificName: 'misfire', count: 50 },
      { scientificName: 'problem', count: 20 },
      { scientificName: 'Vulpes vulpes', count: 100 }
    ]
    const sorted = sortSpeciesHumansLast(data).map((s) => s.scientificName)
    assert.deepEqual(sorted, ['Vulpes vulpes', 'misfire', 'problem', 'ignore'])
  })

  test('non-species labels sort below humans/vehicles even with higher count', () => {
    const data = [
      { scientificName: 'problem', count: 10000 },
      { scientificName: 'Homo sapiens', count: 1 }
    ]
    const sorted = sortSpeciesHumansLast(data).map((s) => s.scientificName)
    assert.deepEqual(sorted, ['Homo sapiens', 'problem'])
  })
})

describe('getTopNonHumanSpecies — non-species tier excluded', () => {
  test('non-species labels are excluded from the top-N default selection', () => {
    const data = [
      { scientificName: 'problem', count: 1000 },
      { scientificName: 'blurred', count: 800 },
      { scientificName: 'Vulpes vulpes', count: 50 },
      { scientificName: 'Canis lupus', count: 30 }
    ]
    const top2 = getTopNonHumanSpecies(data, 2).map((s) => s.scientificName)
    assert.deepEqual(top2, ['Vulpes vulpes', 'Canis lupus'])
  })
})
