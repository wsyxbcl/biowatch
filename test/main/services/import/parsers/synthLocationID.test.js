import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  SYNTH_LOCATION_ID_PREFIX,
  stripSynthLocationID
} from '../../../../../src/main/services/import/parsers/camtrapDP.js'

describe('stripSynthLocationID', () => {
  test('returns null for null input', () => {
    assert.equal(stripSynthLocationID(null), null)
  })

  test('returns null for undefined input', () => {
    assert.equal(stripSynthLocationID(undefined), null)
  })

  test('returns null for empty string', () => {
    assert.equal(stripSynthLocationID(''), null)
  })

  test('strips the synthesized prefix back to null', () => {
    assert.equal(stripSynthLocationID('biowatch-geo:46.5000,6.5000'), null)
  })

  test('strips even when payload is unusual (any value with the prefix is synthesized)', () => {
    assert.equal(stripSynthLocationID(`${SYNTH_LOCATION_ID_PREFIX}anything`), null)
  })

  test('preserves curator-set locationID', () => {
    assert.equal(stripSynthLocationID('siteAlpha'), 'siteAlpha')
  })

  test('preserves locationID that merely starts similarly', () => {
    // Anything that doesn't have the exact prefix passes through.
    assert.equal(stripSynthLocationID('biowatch-other:siteA'), 'biowatch-other:siteA')
  })
})
