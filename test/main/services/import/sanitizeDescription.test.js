import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeDescription } from '../../../../src/main/services/import/sanitizeDescription.js'

describe('sanitizeDescription — null-ish inputs', () => {
  test('returns null for null', () => {
    assert.equal(sanitizeDescription(null), null)
  })

  test('returns null for undefined', () => {
    assert.equal(sanitizeDescription(undefined), null)
  })

  test('returns null for empty string', () => {
    assert.equal(sanitizeDescription(''), null)
  })

  test('returns null for whitespace-only string', () => {
    assert.equal(sanitizeDescription('   \n\t '), null)
  })
})

describe('sanitizeDescription — plain text passthrough', () => {
  test('plain text is returned unchanged', () => {
    assert.equal(sanitizeDescription('plain text'), 'plain text')
  })

  test('plain text is trimmed', () => {
    assert.equal(sanitizeDescription('  plain text  '), 'plain text')
  })
})

describe('sanitizeDescription — generic tag stripping', () => {
  test('unwraps <emphasis>', () => {
    assert.equal(sanitizeDescription('<emphasis>x</emphasis>'), 'x')
  })

  test('unwraps unmapped tag like <superscript>', () => {
    assert.equal(sanitizeDescription('a<superscript>2</superscript>'), 'a2')
  })

  test('removes self-closing / orphan tags', () => {
    assert.equal(sanitizeDescription('a<br/>b'), 'ab')
  })
})

describe('sanitizeDescription — <ulink> conversion', () => {
  test('converts double-quoted ulink with citetitle', () => {
    const input = '<ulink url="https://e.com"><citetitle>Site</citetitle></ulink>'
    assert.equal(sanitizeDescription(input), 'Site (https://e.com)')
  })

  test('converts single-quoted ulink', () => {
    const input = "<ulink url='https://e.com'>Site</ulink>"
    assert.equal(sanitizeDescription(input), 'Site (https://e.com)')
  })

  test('ulink without url attr just unwraps', () => {
    const input = '<ulink>Site</ulink>'
    assert.equal(sanitizeDescription(input), 'Site')
  })

  test('ulink inside surrounding text', () => {
    const input = 'See <ulink url="https://e.com">Site</ulink> for info.'
    assert.equal(sanitizeDescription(input), 'See Site (https://e.com) for info.')
  })
})

describe('sanitizeDescription — paragraphs and lists', () => {
  test('two <para> blocks become two paragraphs separated by one blank line', () => {
    const input = '<para>A</para><para>B</para>'
    assert.equal(sanitizeDescription(input), 'A\n\nB')
  })

  test('<itemizedlist> with two items becomes a flat dash list', () => {
    const input = '<itemizedlist><listitem>one</listitem><listitem>two</listitem></itemizedlist>'
    assert.equal(sanitizeDescription(input), '- one\n- two')
  })
})

describe('sanitizeDescription — HTML entities', () => {
  test('decodes &amp;', () => {
    assert.equal(sanitizeDescription('a &amp; b'), 'a & b')
  })

  test('decodes &lt; and &gt;', () => {
    assert.equal(sanitizeDescription('&lt;tag&gt;'), '<tag>')
  })

  test('decodes &quot;', () => {
    assert.equal(sanitizeDescription('&quot;hi&quot;'), '"hi"')
  })

  test("decodes &apos; and &#39;", () => {
    assert.equal(sanitizeDescription('&apos;a&#39;'), "'a'")
  })

  test('decodes &nbsp; to a space', () => {
    assert.equal(sanitizeDescription('foo&nbsp;bar'), 'foo bar')
  })
})

describe('sanitizeDescription — whitespace cleanup', () => {
  test('collapses multiple spaces within a line', () => {
    assert.equal(sanitizeDescription('a    b'), 'a b')
  })

  test('collapses 3+ blank lines down to 2 (one blank line between paragraphs)', () => {
    assert.equal(sanitizeDescription('A\n\n\n\nB'), 'A\n\nB')
  })

  test('trims leading and trailing whitespace', () => {
    assert.equal(sanitizeDescription('\n  hello  \n'), 'hello')
  })
})

describe('sanitizeDescription — realistic GMU8 fixture', () => {
  test('cleans the GMU8 description sample', () => {
    const input =
      '<emphasis>GMU8_LEUVEN - Camera trap observations in natural habitats south of Leuven (Belgium)</emphasis> is a dataset published by the <ulink url="https://www.inbo.be/en"><citetitle>Research Institute for Nature and Forest (INBO)</citetitle></ulink>.'
    const expected =
      'GMU8_LEUVEN - Camera trap observations in natural habitats south of Leuven (Belgium) is a dataset published by the Research Institute for Nature and Forest (INBO) (https://www.inbo.be/en).'
    assert.equal(sanitizeDescription(input), expected)
  })
})
