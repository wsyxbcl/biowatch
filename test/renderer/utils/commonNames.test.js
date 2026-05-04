import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchGbifCommonName,
  _clearGbifCache,
  getMapDisplayName,
  buildScientificToCommonMap
} from '../../../src/renderer/src/utils/commonNames.js'

// Mock global fetch on each test.
let fetchCalls
function installFetchMock(responses) {
  fetchCalls = []
  let i = 0
  global.fetch = async (url) => {
    fetchCalls.push(url)
    const r = responses[i++]
    if (!r) throw new Error(`unexpected fetch #${i}: ${url}`)
    if (r.reject) throw r.reject
    return {
      ok: r.ok ?? true,
      json: async () => r.json
    }
  }
}

beforeEach(() => {
  _clearGbifCache()
  fetchCalls = []
})

describe('fetchGbifCommonName', () => {
  test('returns null when match has no usageKey', async () => {
    installFetchMock([{ json: {} }])
    const result = await fetchGbifCommonName('Foo bar')
    assert.equal(result, null)
    assert.equal(fetchCalls.length, 1)
  })

  test('returns scored English name from vernacularNames', async () => {
    installFetchMock([
      { json: { usageKey: 12345 } },
      {
        json: {
          results: [
            { vernacularName: 'Ardilla roja', language: 'eng', source: 'EUNIS' },
            {
              vernacularName: 'Eurasian Red Squirrel',
              language: 'eng',
              source: 'Integrated Taxonomic Information System (ITIS)'
            }
          ]
        }
      }
    ])

    const result = await fetchGbifCommonName('Sciurus vulgaris')
    assert.equal(result, 'Eurasian Red Squirrel')
    assert.equal(fetchCalls.length, 2)
  })

  test('caches results in-memory across calls', async () => {
    installFetchMock([
      { json: { usageKey: 1 } },
      { json: { results: [{ vernacularName: 'Cat', language: 'eng', source: 'ITIS' }] } }
    ])

    const a = await fetchGbifCommonName('Felis catus')
    const b = await fetchGbifCommonName('Felis catus')
    assert.equal(a, 'Cat')
    assert.equal(b, 'Cat')
    // Only the first call should hit fetch.
    assert.equal(fetchCalls.length, 2)
  })

  test('caches null results to avoid retry storms', async () => {
    installFetchMock([{ json: {} }])

    const a = await fetchGbifCommonName('Unknown species')
    const b = await fetchGbifCommonName('Unknown species')
    assert.equal(a, null)
    assert.equal(b, null)
    assert.equal(fetchCalls.length, 1)
  })
})

describe('getMapDisplayName', () => {
  test('prefers study-imported vernacular over the dictionary', () => {
    // `vulpes vulpes` resolves to "red fox" via the shipped dictionary, but
    // the study's own vernacular should win.
    const result = getMapDisplayName('Vulpes vulpes', { 'Vulpes vulpes': 'European Red Fox' })
    assert.equal(result, 'European Red Fox')
  })

  test('falls through to the shipped dictionary when no study match', () => {
    const result = getMapDisplayName('Vulpes vulpes', {})
    assert.equal(result, 'red fox')
  })

  test('handles undefined scientificToCommon (callers may omit it)', () => {
    const result = getMapDisplayName('Vulpes vulpes', undefined)
    assert.equal(result, 'red fox')
  })

  test('returns null when no name is known and nothing is in the map', () => {
    const result = getMapDisplayName('Genus speciesthatdoesnotexist', {})
    assert.equal(result, null)
  })

  test('returns null for null/empty scientific names', () => {
    assert.equal(getMapDisplayName(null, { foo: 'bar' }), null)
    assert.equal(getMapDisplayName('', { foo: 'bar' }), null)
    assert.equal(getMapDisplayName(undefined, { foo: 'bar' }), null)
  })
})

describe('buildScientificToCommonMap', () => {
  test('returns an empty object for null/undefined input', () => {
    assert.deepEqual(buildScientificToCommonMap(null), {})
    assert.deepEqual(buildScientificToCommonMap(undefined), {})
  })

  test('returns an empty object for non-array input', () => {
    assert.deepEqual(buildScientificToCommonMap({}), {})
    assert.deepEqual(buildScientificToCommonMap('not an array'), {})
  })

  test('maps scientificName to vernacularNames.eng', () => {
    const result = buildScientificToCommonMap([
      { scientificName: 'Vulpes vulpes', vernacularNames: { eng: 'Red Fox' } },
      { scientificName: 'Sus scrofa', vernacularNames: { eng: 'Wild Boar' } }
    ])
    assert.deepEqual(result, {
      'Vulpes vulpes': 'Red Fox',
      'Sus scrofa': 'Wild Boar'
    })
  })

  test('skips taxa missing scientificName or vernacularNames.eng', () => {
    const result = buildScientificToCommonMap([
      { scientificName: 'Vulpes vulpes', vernacularNames: { eng: 'Red Fox' } },
      { vernacularNames: { eng: 'Orphan' } }, // no scientificName
      { scientificName: 'Sus scrofa' }, // no vernacularNames
      { scientificName: 'Felis catus', vernacularNames: { fra: 'Chat' } }, // no eng
      null // defensive: ignore null entries
    ])
    assert.deepEqual(result, { 'Vulpes vulpes': 'Red Fox' })
  })
})
