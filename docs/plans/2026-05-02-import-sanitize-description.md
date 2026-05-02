# Sanitize dataset descriptions at import time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip XML/DocBook inline markup from dataset descriptions during Camtrap DP and Wildlife Insights imports, preserving `<ulink>` URLs as `text (url)` so the overview tab no longer displays raw tags.

**Architecture:** A single pure regex-based helper (`sanitizeDescription.js`) is wired into the two parsers that consume an externally-provided description string. No DB, no migration, no renderer changes.

**Tech Stack:** Plain JavaScript (ESM), `node:test` + `node:assert/strict` for unit tests.

**Spec:** `docs/specs/2026-05-02-import-sanitize-description-design.md`

---

## File Structure

- **Create** `src/main/services/import/sanitizeDescription.js` — pure helper, one default-style export.
- **Create** `test/main/services/import/sanitizeDescription.test.js` — unit tests using `node:test`.
- **Modify** `src/main/services/import/parsers/camtrapDP.js` — wire sanitizer into metadata insert.
- **Modify** `src/main/services/import/parsers/wildlifeInsights.js` — wire sanitizer into metadata insert.
- **Modify** `docs/import-export.md` — note about sanitization in the Camtrap DP section.
- **Modify** `docs/data-formats.md` — note that imported `description` is sanitized.

Each task below is independently committable.

---

### Task 1: Create `sanitizeDescription` helper with tests

**Files:**
- Create: `src/main/services/import/sanitizeDescription.js`
- Test: `test/main/services/import/sanitizeDescription.test.js`

This task is pure logic (no DB, no Electron). We write the tests first, watch them fail, then implement.

- [ ] **Step 1: Write the failing test file**

Create `test/main/services/import/sanitizeDescription.test.js`:

```js
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
    assert.equal(sanitizeDescription('a<br/>b'), 'a b')
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
```

- [ ] **Step 2: Run the test file to confirm it fails for the right reason**

Run:

```bash
node --test test/main/services/import/sanitizeDescription.test.js
```

Expected: all tests fail with a module-resolution error like `Cannot find module '.../sanitizeDescription.js'`. That's the correct failure — the implementation file doesn't exist yet.

- [ ] **Step 3: Create the implementation**

Create `src/main/services/import/sanitizeDescription.js`:

```js
const ULINK_DOUBLE = /<ulink\s+url="([^"]*)"\s*>([\s\S]*?)<\/ulink>/gi
const ULINK_SINGLE = /<ulink\s+url='([^']*)'\s*>([\s\S]*?)<\/ulink>/gi
const PARA = /<para\s*>([\s\S]*?)<\/para>/gi
const LIST_CONTAINER = /<\/?(itemizedlist|orderedlist)\s*>/gi
const LIST_ITEM = /<listitem\s*>([\s\S]*?)<\/listitem>/gi
const ANY_TAG = /<\/?[a-zA-Z][^>]*>/g

const ENTITIES = [
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
  [/&#39;/g, "'"]
]

export function sanitizeDescription(input) {
  if (input == null) return null
  if (typeof input !== 'string') return null

  let s = input

  s = s.replace(ULINK_DOUBLE, (_, url, inner) => `${inner} (${url})`)
  s = s.replace(ULINK_SINGLE, (_, url, inner) => `${inner} (${url})`)

  s = s.replace(PARA, (_, inner) => `\n\n${inner}\n\n`)

  s = s.replace(LIST_ITEM, (_, inner) => `\n- ${inner}`)
  s = s.replace(LIST_CONTAINER, '\n')

  s = s.replace(ANY_TAG, '')

  for (const [pattern, replacement] of ENTITIES) {
    s = s.replace(pattern, replacement)
  }

  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  s = s.trim()

  return s.length === 0 ? null : s
}
```

- [ ] **Step 4: Run the test file again to confirm it passes**

Run:

```bash
node --test test/main/services/import/sanitizeDescription.test.js
```

Expected: every test passes (`# pass <N>`, `# fail 0`).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/import/sanitizeDescription.js test/main/services/import/sanitizeDescription.test.js
git commit -m "feat(import): add sanitizeDescription helper for DocBook tags"
```

---

### Task 2: Wire sanitizer into Camtrap DP parser

**Files:**
- Modify: `src/main/services/import/parsers/camtrapDP.js` (import + line 193)

The integration test `test/integration/import/camtrapDP.test.js` already exercises this parser end-to-end. It does not currently assert on `description`, so a regression check here is "the existing tests still pass" — the change is a single string transform on one field.

- [ ] **Step 1: Add the import at the top of `camtrapDP.js`**

Open `src/main/services/import/parsers/camtrapDP.js`. After the existing import block (currently ends at line 15 with the `normalizeScientificName` import), add:

```js
import { sanitizeDescription } from '../sanitizeDescription.js'
```

Result, for context:

```js
import { normalizeScientificName } from '../../../../shared/commonNames/normalize.js'
import { sanitizeDescription } from '../sanitizeDescription.js'
```

- [ ] **Step 2: Replace the description assignment**

In the same file, find the metadata record near line 193:

```js
description: data.description || null,
```

Replace with:

```js
description: sanitizeDescription(data.description),
```

(The `|| null` is no longer needed — the helper returns `null` for null/empty/whitespace.)

- [ ] **Step 3: Run the Camtrap DP integration test**

Run:

```bash
npm run test:rebuild && node --test test/integration/import/camtrapDP.test.js test/integration/import/camtrapDP-null-fks.test.js test/integration/import/camtrapDP-event-expansion.test.js && npm run test:rebuild-electron
```

Expected: all tests pass. The change touches only the value written to `studies.description`; nothing the existing tests assert on changes.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/import/parsers/camtrapDP.js
git commit -m "feat(import): sanitize description on Camtrap DP import"
```

---

### Task 3: Wire sanitizer into Wildlife Insights parser

**Files:**
- Modify: `src/main/services/import/parsers/wildlifeInsights.js` (import + line 135)

Same pattern as Task 2. Wildlife Insights descriptions are typically clean text already, so this is a no-op in practice but keeps the two parsers symmetric.

- [ ] **Step 1: Add the import at the top of `wildlifeInsights.js`**

Open `src/main/services/import/parsers/wildlifeInsights.js`. After the existing import block (currently ends at line 15 with the `DEFAULT_SEQUENCE_GAP` import), add:

```js
import { sanitizeDescription } from '../sanitizeDescription.js'
```

- [ ] **Step 2: Replace the description assignment**

Find the metadata record near line 135:

```js
description: data.data?.description || null,
```

Replace with:

```js
description: sanitizeDescription(data.data?.description),
```

- [ ] **Step 3: Run the Wildlife Insights integration test**

Run:

```bash
npm run test:rebuild && node --test test/integration/import/wildlifeInsights.test.js && npm run test:rebuild-electron
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/import/parsers/wildlifeInsights.js
git commit -m "feat(import): sanitize description on Wildlife Insights import"
```

---

### Task 4: Update docs

**Files:**
- Modify: `docs/import-export.md`
- Modify: `docs/data-formats.md`

Per the project's `CLAUDE.md`, doc files should track changes that affect import/export and data formats.

- [ ] **Step 1: Find the Camtrap DP import section in `docs/import-export.md`**

Run:

```bash
grep -n "Camtrap\|camtrapDP\|datapackage" docs/import-export.md | head
```

Use the result to locate the section that describes the Camtrap DP import flow.

- [ ] **Step 2: Add a note in the Camtrap DP import section of `docs/import-export.md`**

In the Camtrap DP import section, add this paragraph at the end of the section (or as a sub-bullet, matching the existing style of the section):

```markdown
**Description sanitization.** Camtrap DP packages generated from GBIF/EML
metadata frequently contain DocBook inline markup (`<emphasis>`, `<para>`,
`<ulink url="…"><citetitle>…</citetitle></ulink>`, etc.) in the
`description` field. On import the description passes through
`src/main/services/import/sanitizeDescription.js`, which strips tags, decodes
common HTML entities, and rewrites `<ulink>` as `text (url)` so URLs survive
in the plain-text output stored in `studies.description`.
```

(Match the surrounding section's heading depth and bullet style; the wording above is the substantive content.)

- [ ] **Step 3: Update `docs/data-formats.md`**

Locate line 26 (`"description": "Dataset description (Markdown supported)"`) using:

```bash
grep -n "Markdown supported" docs/data-formats.md
```

Just below the JSON code block that contains that line, add a clarifying note:

```markdown
> **Note on storage:** When this field reaches Biowatch's database
> (`studies.description`), it has been passed through
> `sanitizeDescription` (see `src/main/services/import/sanitizeDescription.js`)
> — DocBook/HTML inline tags are stripped, `<ulink>` URLs are inlined as
> `text (url)`, and common HTML entities are decoded.
```

- [ ] **Step 4: Commit**

```bash
git add docs/import-export.md docs/data-formats.md
git commit -m "docs: note description sanitization in import/data-format docs"
```

---

## Final verification

After Task 4 is committed, run the full unit-test slice that this change touches plus the import integration tests once more, to confirm nothing regressed:

```bash
node --test test/main/services/import/sanitizeDescription.test.js
npm run test:rebuild && node --test test/integration/import/camtrapDP.test.js test/integration/import/camtrapDP-null-fks.test.js test/integration/import/camtrapDP-event-expansion.test.js test/integration/import/wildlifeInsights.test.js && npm run test:rebuild-electron
```

Expected: everything passes.

For a manual check (optional), re-import the GMU8 Leuven dataset and confirm the overview tab description shows clean prose with `Research Institute for Nature and Forest (INBO) (https://www.inbo.be/en)` style URL inlining instead of literal tags.
