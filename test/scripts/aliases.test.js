import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { buildAliasMap } from '../../scripts/lib/aliases.js'

describe('buildAliasMap', () => {
  test('returns a Map keyed by normalized label', () => {
    const map = buildAliasMap()
    assert.ok(map instanceof Map)
    assert.ok(map.size > 0, 'expected at least one alias entry')
  })

  test('maps a known snake_case model label to its binomial', () => {
    // Some species sources ship a snake_case label alongside the canonical
    // binomial (e.g. panthera_uncia → panthera uncia). The map lets a
    // build step keyed by binomial also enrich the snake_case dictionary key.
    const map = buildAliasMap()
    const sci = map.get('panthera_uncia')
    assert.equal(sci, 'panthera uncia')
  })

  test('does not include identity entries (label === sci)', () => {
    const map = buildAliasMap()
    for (const [label, sci] of map) {
      assert.notEqual(label, sci, `unexpected identity alias: ${label}`)
    }
  })
})
