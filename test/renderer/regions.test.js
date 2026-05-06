import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { REGIONS, getRegion, withAlpha } from '../../src/renderer/src/models/regions.js'

describe('REGIONS registry', () => {
  test('contains worldwide, europe, himalayas, custom', () => {
    assert.equal(REGIONS.worldwide.label, 'Worldwide')
    assert.equal(REGIONS.europe.label, 'Europe')
    assert.equal(REGIONS.himalayas.label, 'Himalayas')
    assert.equal(REGIONS.custom.label, 'Custom')
  })

  test('worldwide has no geojson', () => {
    assert.equal(REGIONS.worldwide.geojson, null)
  })

  test('europe and himalayas reference geojson files', () => {
    assert.equal(REGIONS.europe.geojson, 'europe')
    assert.equal(REGIONS.himalayas.geojson, 'himalayas')
  })
})

describe('getRegion', () => {
  test('returns the region for a known id', () => {
    assert.equal(getRegion('europe').label, 'Europe')
  })

  test('returns null for an unknown id', () => {
    assert.equal(getRegion('atlantis'), null)
  })
})

describe('withAlpha', () => {
  test('appends an alpha hex byte to a 6-digit hex color', () => {
    assert.equal(withAlpha('#047857', 0.5), '#04785780')
  })

  test('clamps alpha to [0, 1]', () => {
    assert.equal(withAlpha('#047857', 1.5), '#047857ff')
    assert.equal(withAlpha('#047857', -0.2), '#04785700')
  })
})
