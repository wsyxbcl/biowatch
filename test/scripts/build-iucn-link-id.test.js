import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { parseRedlistRow, pickLatestPerTaxon } from '../../scripts/build-iucn-link-id.lib.js'

describe('parseRedlistRow', () => {
  test('extracts IDs from a Vulnerable row', () => {
    const row = {
      scientificName: 'Helarctos malayanus',
      redlistCategory: 'Vulnerable',
      internalTaxonId: '9760',
      assessmentId: '123798233',
      yearPublished: '2017',
      rationale: 'should be ignored'
    }
    assert.deepEqual(parseRedlistRow(row), {
      name: 'helarctos malayanus',
      taxonId: 9760,
      assessmentId: 123798233,
      year: 2017
    })
  })

  test('extracts IDs from an Endangered row', () => {
    const row = {
      scientificName: 'Panthera tigris',
      redlistCategory: 'Endangered',
      internalTaxonId: '15955',
      assessmentId: '214862019',
      yearPublished: '2022'
    }
    assert.equal(parseRedlistRow(row).name, 'panthera tigris')
    assert.equal(parseRedlistRow(row).taxonId, 15955)
  })

  test('extracts IDs from a Critically Endangered row', () => {
    const row = {
      scientificName: 'Ateles hybridus',
      redlistCategory: 'Critically Endangered',
      internalTaxonId: '39961',
      assessmentId: '1',
      yearPublished: '2020'
    }
    assert.equal(parseRedlistRow(row).taxonId, 39961)
  })

  test('returns null for non-threatened categories', () => {
    for (const cat of ['Least Concern', 'Near Threatened', 'Data Deficient', 'Extinct']) {
      const row = {
        scientificName: 'Foo bar',
        redlistCategory: cat,
        internalTaxonId: '1',
        assessmentId: '2',
        yearPublished: '2020'
      }
      assert.equal(parseRedlistRow(row), null, `expected null for ${cat}`)
    }
  })

  test('returns null when scientificName is missing or blank', () => {
    assert.equal(parseRedlistRow({ redlistCategory: 'Vulnerable' }), null)
    assert.equal(parseRedlistRow({ scientificName: '   ', redlistCategory: 'Vulnerable' }), null)
  })

  test('returns null when IDs are not parseable as integers', () => {
    const row = {
      scientificName: 'Foo bar',
      redlistCategory: 'Vulnerable',
      internalTaxonId: '',
      assessmentId: 'not-a-number',
      yearPublished: '2020'
    }
    assert.equal(parseRedlistRow(row), null)
  })

  test('lowercases the scientific name', () => {
    const row = {
      scientificName: 'AILUROPODA MELANOLEUCA',
      redlistCategory: 'Vulnerable',
      internalTaxonId: '712',
      assessmentId: '121745669',
      yearPublished: '2016'
    }
    assert.equal(parseRedlistRow(row).name, 'ailuropoda melanoleuca')
  })
})

describe('pickLatestPerTaxon', () => {
  test('keeps the entry with the highest year per name', () => {
    const rows = [
      { name: 'panthera tigris', taxonId: 15955, assessmentId: 1, year: 2015 },
      { name: 'panthera tigris', taxonId: 15955, assessmentId: 2, year: 2022 },
      { name: 'panthera tigris', taxonId: 15955, assessmentId: 3, year: 2018 }
    ]
    const out = pickLatestPerTaxon(rows)
    assert.equal(out.size, 1)
    assert.equal(out.get('panthera tigris').assessmentId, 2)
    assert.equal(out.get('panthera tigris').year, 2022)
  })

  test('returns a map keyed by name', () => {
    const rows = [
      { name: 'panthera tigris', taxonId: 1, assessmentId: 1, year: 2022 },
      { name: 'helarctos malayanus', taxonId: 2, assessmentId: 2, year: 2017 }
    ]
    const out = pickLatestPerTaxon(rows)
    assert.equal(out.size, 2)
    assert.ok(out.has('panthera tigris'))
    assert.ok(out.has('helarctos malayanus'))
  })

  test('handles empty input', () => {
    assert.equal(pickLatestPerTaxon([]).size, 0)
  })
})
