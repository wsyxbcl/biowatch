import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseRedlistRow,
  pickLatestPerTaxon,
  mergeIdsIntoSpeciesData
} from '../../scripts/build-iucn-link-id.lib.js'

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

describe('mergeIdsIntoSpeciesData', () => {
  const meta = { sourceVersion: '2025-1', refreshedAt: '2026-05-02' }

  test('attaches IDs to threatened entries by direct binomial match', () => {
    const data = {
      'panthera tigris': { iucn: 'EN', blurb: 'tiger blurb' },
      'felis catus': { iucn: 'LC', blurb: 'cat blurb' }
    }
    const ids = new Map([
      [
        'panthera tigris',
        { name: 'panthera tigris', taxonId: 15955, assessmentId: 214862019, year: 2022 }
      ]
    ])
    const out = mergeIdsIntoSpeciesData(data, ids, new Map(), meta)
    assert.equal(out['panthera tigris'].iucnTaxonId, 15955)
    assert.equal(out['panthera tigris'].iucnAssessmentId, 214862019)
    // LC entries are never enriched
    assert.equal(out['felis catus'].iucnTaxonId, undefined)
  })

  test('writes top-level _iucnSourceVersion and _iucnRefreshedAt', () => {
    const out = mergeIdsIntoSpeciesData({}, new Map(), new Map(), meta)
    assert.equal(out._iucnSourceVersion, '2025-1')
    assert.equal(out._iucnRefreshedAt, '2026-05-02')
  })

  test('attaches IDs through the alias map for snake_case dictionary keys', () => {
    const data = {
      hatinh_langur: { iucn: 'CR', blurb: 'langur blurb' }
    }
    const ids = new Map([
      [
        'trachypithecus hatinhensis',
        { name: 'trachypithecus hatinhensis', taxonId: 22043, assessmentId: 1, year: 2020 }
      ]
    ])
    const aliases = new Map([['hatinh_langur', 'trachypithecus hatinhensis']])
    const out = mergeIdsIntoSpeciesData(data, ids, aliases, meta)
    assert.equal(out.hatinh_langur.iucnTaxonId, 22043)
  })

  test('strips stale IDs from threatened entries with no match (idempotent)', () => {
    const data = {
      'foo bar': { iucn: 'VU', iucnTaxonId: 999, iucnAssessmentId: 888, blurb: 'x' }
    }
    const out = mergeIdsIntoSpeciesData(data, new Map(), new Map(), meta)
    assert.equal(out['foo bar'].iucnTaxonId, undefined)
    assert.equal(out['foo bar'].iucnAssessmentId, undefined)
    // other fields untouched
    assert.equal(out['foo bar'].blurb, 'x')
  })

  test('does not touch non-threatened entries (preserves existing IDs if present)', () => {
    // We never write IDs onto LC entries, but if a previous bug left some
    // there, this function shouldn't strip them either — we only manage the
    // VU/EN/CR slot.
    const data = {
      'least one': { iucn: 'LC', blurb: 'x', iucnTaxonId: 1, iucnAssessmentId: 2 }
    }
    const out = mergeIdsIntoSpeciesData(data, new Map(), new Map(), meta)
    assert.equal(out['least one'].iucnTaxonId, 1)
    assert.equal(out['least one'].iucnAssessmentId, 2)
  })

  test('two reruns of the same input produce equal output (idempotency)', () => {
    const data = {
      'panthera tigris': { iucn: 'EN', blurb: 'x' },
      'foo bar': { iucn: 'VU', iucnTaxonId: 999, blurb: 'y' }
    }
    const ids = new Map([
      [
        'panthera tigris',
        { name: 'panthera tigris', taxonId: 15955, assessmentId: 214862019, year: 2022 }
      ]
    ])
    const a = mergeIdsIntoSpeciesData(data, ids, new Map(), meta)
    const b = mergeIdsIntoSpeciesData(a, ids, new Map(), meta)
    assert.deepEqual(a, b)
  })
})
