import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { filterSpecies, classSummary } from '../../src/renderer/src/models/speciesPanelHelpers.js'

const sampleSpecies = [
  { common: 'Red fox', scientific: 'Vulpes vulpes', class: 'mammal' },
  { common: 'Grey wolf', scientific: 'Canis lupus', class: 'mammal' },
  { common: 'Capercaillie', scientific: 'Tetrao urogallus', class: 'bird' }
]

describe('filterSpecies', () => {
  test('returns all species when query is empty', () => {
    assert.equal(filterSpecies(sampleSpecies, '').length, 3)
    assert.equal(filterSpecies(sampleSpecies, '   ').length, 3)
  })

  test('matches common name (case-insensitive)', () => {
    const out = filterSpecies(sampleSpecies, 'fox')
    assert.equal(out.length, 1)
    assert.equal(out[0].common, 'Red fox')
  })

  test('matches scientific name (case-insensitive)', () => {
    const out = filterSpecies(sampleSpecies, 'canis')
    assert.equal(out.length, 1)
    assert.equal(out[0].common, 'Grey wolf')
  })

  test('returns empty when no match', () => {
    assert.equal(filterSpecies(sampleSpecies, 'zzz').length, 0)
  })
})

describe('classSummary', () => {
  test('uses provided summary when species[] is empty', () => {
    const data = {
      species: [],
      summary: {
        total: 100,
        classes: [
          { id: 'mammal', label: 'Mammals', icon: '🦌', approx_count: 60 },
          { id: 'bird', label: 'Birds', icon: '🦅', approx_count: 40 }
        ]
      }
    }
    const out = classSummary(data)
    assert.equal(out.total, 100)
    assert.equal(out.classes.length, 2)
    assert.equal(out.classes[0].count, 60)
    assert.equal(out.classes[0].approximate, true)
  })

  test('derives counts from species[] when present', () => {
    const data = { species: sampleSpecies }
    const out = classSummary(data)
    assert.equal(out.total, 3)
    const mammals = out.classes.find((c) => c.id === 'mammal')
    assert.equal(mammals.count, 2)
    assert.equal(mammals.approximate, false)
    const birds = out.classes.find((c) => c.id === 'bird')
    assert.equal(birds.count, 1)
  })

  test('returns null classes for species without a class field', () => {
    const data = {
      species: [{ common: 'Red fox', scientific: 'Vulpes vulpes' }]
    }
    const out = classSummary(data)
    assert.equal(out.classes, null)
  })
})
