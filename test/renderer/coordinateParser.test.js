import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseCoordinates } from '../../src/renderer/src/deployments/coordinateParser.js'

describe('parseCoordinates', () => {
  test('parses comma-separated', () => {
    assert.deepEqual(parseCoordinates('48.7384, -121.4521'), { lat: 48.7384, lon: -121.4521 })
  })

  test('parses space-separated', () => {
    assert.deepEqual(parseCoordinates('48.7384 -121.4521'), { lat: 48.7384, lon: -121.4521 })
  })

  test('parses with trailing/leading whitespace', () => {
    assert.deepEqual(parseCoordinates('  48.7384, -121.4521  '), { lat: 48.7384, lon: -121.4521 })
  })

  test('parses integer coordinates', () => {
    assert.deepEqual(parseCoordinates('48, -121'), { lat: 48, lon: -121 })
  })

  test('parses both negative', () => {
    assert.deepEqual(parseCoordinates('-48.7, -121.4'), { lat: -48.7, lon: -121.4 })
  })

  test('returns null for invalid input', () => {
    assert.equal(parseCoordinates('not coordinates'), null)
    assert.equal(parseCoordinates('48.7'), null)
    assert.equal(parseCoordinates(''), null)
    assert.equal(parseCoordinates('TBD'), null)
  })

  test('returns null for out-of-range latitude', () => {
    assert.equal(parseCoordinates('91, 0'), null)
    assert.equal(parseCoordinates('-91, 0'), null)
  })

  test('returns null for out-of-range longitude', () => {
    assert.equal(parseCoordinates('0, 181'), null)
    assert.equal(parseCoordinates('0, -181'), null)
  })

  test('handles null/undefined input', () => {
    assert.equal(parseCoordinates(null), null)
    assert.equal(parseCoordinates(undefined), null)
  })
})
