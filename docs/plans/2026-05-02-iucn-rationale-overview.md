# IUCN Rationale in Species Tooltip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a license-clean click-through from the species hover card on the Overview tab to the official IUCN Red List assessment page, for species classified as Vulnerable, Endangered, or Critically Endangered.

**Architecture:** A new build script (`scripts/build-iucn-link-id.js`) reads the gitignored IUCN bulk-export CSV from `data/redlist_species_data_*/assessments.csv`, extracts only the `internalTaxonId` and `assessmentId` for VU/EN/CR rows (no rationale text per IUCN T&C Section 4), and merges them into the committed `src/shared/speciesInfo/data.json`. The species hover card (`SpeciesTooltipContent.jsx`) gains a "Why threatened?" call-to-action above the Wikipedia blurb when those IDs are present; the CTA is a regular `<a target="_blank">` that the existing `setWindowOpenHandler` routes through `shell.openExternal` to the user's default browser.

**Tech Stack:** Node `node:test` for unit tests, `csv-parser` (already a dep) for streaming the 156 MB CSV, React + Tailwind for the UI changes, no new runtime dependencies.

**Spec:** `docs/specs/2026-05-02-iucn-rationale-overview-design.md`

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `data/.gitkeep` | New | Keeps the `data/` folder tracked in git so a fresh clone has the slot ready for the maintainer's IUCN export. |
| `.gitignore` | Edit | Adds `data/redlist_species_data_*/` so bulk exports never get committed. |
| `scripts/lib/aliases.js` | New | Exports `buildAliasMap()` — the label → scientific-name alias map. Extracted from `build-species-info.js` so both builders import it. |
| `scripts/build-iucn-link-id.js` | New | CLI entrypoint. Resolves the IUCN export folder, streams the CSV, calls into the lib, writes `data.json` atomically, prints a summary. |
| `scripts/build-iucn-link-id.lib.js` | New | Pure functions: `parseRedlistRow`, `pickLatestPerTaxon`, `mergeIdsIntoSpeciesData`. No I/O. Fully unit-tested. |
| `test/scripts/build-iucn-link-id.test.js` | New | Unit tests for the lib. |
| `test/scripts/aliases.test.js` | New | Unit test for the extracted alias map. |
| `package.json` | Edit | Adds an `iucn-link-id:build` npm script (mirrors the existing `species-info:build`). |
| `src/shared/speciesInfo/data.json` | Edit | Gets two top-level metadata keys (`_iucnSourceVersion`, `_iucnRefreshedAt`) and two new per-species fields (`iucnTaxonId`, `iucnAssessmentId`) on VU/EN/CR entries. |
| `src/shared/speciesInfo/resolver.js` | Edit | JSDoc updates only. |
| `src/renderer/src/ui/SpeciesTooltipContent.jsx` | Edit | New "Why threatened?" CTA block; demoted Wikipedia "About" section when CTA is present. |
| `docs/development.md` | Edit | Documents the IUCN bulk-export workflow, the `data/` convention, and the new build script. |

---

### Task 1: Add `data/` folder and gitignore the redlist exports

**Files:**
- Create: `data/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create the empty placeholder file**

```bash
mkdir -p data && : > data/.gitkeep
```

- [ ] **Step 2: Append the gitignore entry**

Open `.gitignore` and add this section at the end:

```
# IUCN Red List bulk exports — see docs/development.md
# Account-bound, non-redistributable per IUCN T&C section 4.
data/redlist_species_data_*/
```

- [ ] **Step 3: Verify the gitignore works**

Run: `git check-ignore -v data/redlist_species_data_anything/assessments.csv`
Expected: prints the matching `.gitignore:<line>:data/redlist_species_data_*/` rule.

Run: `git status -s data/`
Expected: `?? data/.gitkeep` (and nothing else).

- [ ] **Step 4: Commit**

```bash
git add data/.gitkeep .gitignore
git commit -m "chore(data): add data/ folder for IUCN bulk exports

The IUCN Red List bulk export is account-bound and not redistributable,
so individual exports are gitignored; .gitkeep ensures fresh clones have
the slot ready for a maintainer to drop their download in."
```

- [ ] **Step 5: Move the existing IUCN export into `data/`**

Move whatever the maintainer already downloaded into the new folder. Run from the worktree root:

```bash
mv ../../redlist_species_data_*/ data/ 2>/dev/null || mv ../redlist_species_data_*/ data/ 2>/dev/null || echo "no export to move — the maintainer will drop one in later"
```

(Adjust the source path to wherever the export currently lives — for the original brainstorming the export is at the repo root of the main worktree, `../../redlist_species_data_*/`.)

Run: `ls data/redlist_species_data_*/assessments.csv`
Expected: prints one matching path.

Run: `git status -s data/`
Expected: `?? data/.gitkeep` is gone (already committed); the moved folder is *not* shown (gitignored). Nothing to commit here — the folder is intentionally untracked.

---

### Task 2: Extract `buildAliasMap` into a shared util

The existing `scripts/build-species-info.js` defines `buildAliasMap` as a private function at line 199. The new IUCN builder needs the same map. Move it to a shared module without changing behaviour, with a unit test that locks in the current shape.

**Files:**
- Create: `scripts/lib/aliases.js`
- Create: `test/scripts/aliases.test.js`
- Modify: `scripts/build-species-info.js` (lines 199-212; replace with import)

- [ ] **Step 1: Write the failing test**

Create `test/scripts/aliases.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { buildAliasMap } from '../../scripts/lib/aliases.js'

describe('buildAliasMap', () => {
  test('returns a Map keyed by normalized label', () => {
    const map = buildAliasMap()
    assert.ok(map instanceof Map)
    assert.ok(map.size > 0, 'expected at least one alias entry')
  })

  test('maps a known DeepFaune label to its binomial', () => {
    // DeepFaune ships labels like "lagothrix_lagotricha" alongside the
    // canonical binomial "lagothrix lagotricha".
    const map = buildAliasMap()
    const sci = map.get('lagothrix_lagotricha')
    assert.equal(sci, 'lagothrix lagotricha')
  })

  test('does not include identity entries (label === sci)', () => {
    const map = buildAliasMap()
    for (const [label, sci] of map) {
      assert.notEqual(label, sci, `unexpected identity alias: ${label}`)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scripts/aliases.test.js`
Expected: FAIL — `Cannot find module '../../scripts/lib/aliases.js'`.

- [ ] **Step 3: Create the shared util**

Create `scripts/lib/aliases.js`:

```js
import speciesnetSource from '../../src/shared/commonNames/sources/speciesnet.json' with { type: 'json' }
import deepfauneSource from '../../src/shared/commonNames/sources/deepfaune.json' with { type: 'json' }
import manasSource from '../../src/shared/commonNames/sources/manas.json' with { type: 'json' }
import extras from '../../src/shared/commonNames/extras.json' with { type: 'json' }
import { normalizeScientificName } from '../../src/shared/commonNames/normalize.js'

/**
 * Build a label → scientificName alias map from every source that emits both
 * fields. Some models (DeepFaune, Manas, plus our own extras) ship a snake_case
 * label alongside the canonical binomial — this map lets a build step keyed
 * by binomial also enrich the snake_case dictionary key.
 */
export function buildAliasMap() {
  const aliases = new Map()
  const sources = [speciesnetSource, deepfauneSource, manasSource, extras]
  for (const src of sources) {
    for (const entry of src.entries || []) {
      if (!entry.scientificName || !entry.label) continue
      const sci = normalizeScientificName(entry.scientificName)
      const label = normalizeScientificName(entry.label)
      if (!sci || !label || sci === label) continue
      aliases.set(label, sci)
    }
  }
  return aliases
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scripts/aliases.test.js`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Replace the inlined copy in `build-species-info.js`**

In `scripts/build-species-info.js`, near the top with the other imports (around line 30, after the JSON imports), add:

```js
import { buildAliasMap } from './lib/aliases.js'
```

Then delete lines 193-212 (the inlined `buildAliasMap` function and its preceding comment block — open the file to confirm exact line numbers if they shifted). The `applyAliases` function at line 218 stays; it already calls `buildAliasMap()`.

You can also delete the now-unused imports of `speciesnetSource`, `deepfauneSource`, `manasSource`, `extras`, and `normalizeScientificName` if they're not used elsewhere in `build-species-info.js`. Search the file for each to confirm before deleting:

```bash
grep -n "speciesnetSource\|deepfauneSource\|manasSource\|^.*\\bextras\\b\|normalizeScientificName" scripts/build-species-info.js
```

If any only appear in the now-deleted block, remove them too.

- [ ] **Step 6: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: all tests pass, including the existing `test/scripts/build-species-info.test.js`.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/aliases.js scripts/build-species-info.js test/scripts/aliases.test.js
git commit -m "refactor(scripts): extract buildAliasMap into shared util

The IUCN link-id builder (next commit) needs the same label→binomial
alias map that build-species-info.js uses. Move it to scripts/lib/aliases.js
so both builders import from one place."
```

---

### Task 3: TDD `parseRedlistRow` — filter VU/EN/CR rows and extract IDs

`parseRedlistRow` takes a single CSV row (a plain object from `csv-parser`) and returns either `{ name, taxonId, assessmentId, year }` for a threatened-category row, or `null` for any other row (including invalid/malformed ones).

**Files:**
- Create: `test/scripts/build-iucn-link-id.test.js`
- Create: `scripts/build-iucn-link-id.lib.js`

- [ ] **Step 1: Write the failing test**

Create `test/scripts/build-iucn-link-id.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { parseRedlistRow } from '../../scripts/build-iucn-link-id.lib.js'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scripts/build-iucn-link-id.test.js`
Expected: FAIL — `Cannot find module '../../scripts/build-iucn-link-id.lib.js'`.

- [ ] **Step 3: Implement `parseRedlistRow`**

Create `scripts/build-iucn-link-id.lib.js`:

```js
const THREATENED = new Set(['Vulnerable', 'Endangered', 'Critically Endangered'])

/**
 * Extract the four fields we keep from a single assessments.csv row.
 * @param {Record<string,string>} row
 * @returns {{ name: string, taxonId: number, assessmentId: number, year: number } | null}
 */
export function parseRedlistRow(row) {
  if (!row) return null
  if (!THREATENED.has(row.redlistCategory)) return null

  const name = typeof row.scientificName === 'string' ? row.scientificName.trim().toLowerCase() : ''
  if (!name) return null

  const taxonId = Number.parseInt(row.internalTaxonId, 10)
  const assessmentId = Number.parseInt(row.assessmentId, 10)
  const year = Number.parseInt(row.yearPublished, 10)
  if (!Number.isFinite(taxonId) || !Number.isFinite(assessmentId)) return null

  return { name, taxonId, assessmentId, year: Number.isFinite(year) ? year : 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scripts/build-iucn-link-id.test.js`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-iucn-link-id.lib.js test/scripts/build-iucn-link-id.test.js
git commit -m "feat(scripts): parseRedlistRow extracts threatened-species IDs

First piece of the IUCN link-id builder: pure function that filters CSV
rows down to VU/EN/CR and pulls only the public identifiers (taxonId,
assessmentId), discarding the rationale and other text fields per IUCN
T&C section 4."
```

---

### Task 4: TDD `pickLatestPerTaxon` — collapse duplicate rows

The bulk export occasionally has multiple rows for the same taxon (e.g., regional + global assessments, or historical versions). For our purposes the latest year wins.

**Files:**
- Modify: `test/scripts/build-iucn-link-id.test.js` (add cases)
- Modify: `scripts/build-iucn-link-id.lib.js` (add function)

- [ ] **Step 1: Write the failing test**

Append to `test/scripts/build-iucn-link-id.test.js`:

```js
import { pickLatestPerTaxon } from '../../scripts/build-iucn-link-id.lib.js'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scripts/build-iucn-link-id.test.js`
Expected: FAIL — `pickLatestPerTaxon is not exported` (or undefined).

- [ ] **Step 3: Implement `pickLatestPerTaxon`**

Append to `scripts/build-iucn-link-id.lib.js`:

```js
/**
 * Collapse a stream of parsed rows into a map of name → latest entry.
 * When multiple rows share a name, the one with the highest `year` wins.
 * @param {Array<{name:string,taxonId:number,assessmentId:number,year:number}>} rows
 * @returns {Map<string,{name:string,taxonId:number,assessmentId:number,year:number}>}
 */
export function pickLatestPerTaxon(rows) {
  const out = new Map()
  for (const row of rows) {
    const prev = out.get(row.name)
    if (!prev || row.year > prev.year) out.set(row.name, row)
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scripts/build-iucn-link-id.test.js`
Expected: PASS — 10 tests passing total.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-iucn-link-id.lib.js test/scripts/build-iucn-link-id.test.js
git commit -m "feat(scripts): pickLatestPerTaxon collapses duplicate rows

Defensive against the bulk export occasionally containing multiple
assessments for the same taxon (e.g., older versions). Latest year wins."
```

---

### Task 5: TDD `mergeIdsIntoSpeciesData` — idempotent merge into the data.json shape

This is the merge step. It takes the existing `data.json` map, the IUCN map (name → IDs), and the alias map (label → binomial), and produces a new `data.json` map with `iucnTaxonId` and `iucnAssessmentId` set on VU/EN/CR entries (or stripped if no match found, so reruns are idempotent). It also accepts metadata (`sourceVersion`, `refreshedAt`) and writes the two `_iucn*` top-level keys.

**Files:**
- Modify: `test/scripts/build-iucn-link-id.test.js` (add cases)
- Modify: `scripts/build-iucn-link-id.lib.js` (add function)

- [ ] **Step 1: Write the failing test**

Append to `test/scripts/build-iucn-link-id.test.js`:

```js
import { mergeIdsIntoSpeciesData } from '../../scripts/build-iucn-link-id.lib.js'

describe('mergeIdsIntoSpeciesData', () => {
  const meta = { sourceVersion: '2025-1', refreshedAt: '2026-05-02' }

  test('attaches IDs to threatened entries by direct binomial match', () => {
    const data = {
      'panthera tigris': { iucn: 'EN', blurb: 'tiger blurb' },
      'felis catus': { iucn: 'LC', blurb: 'cat blurb' }
    }
    const ids = new Map([
      ['panthera tigris', { name: 'panthera tigris', taxonId: 15955, assessmentId: 214862019, year: 2022 }]
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
      ['trachypithecus hatinhensis', {
        name: 'trachypithecus hatinhensis', taxonId: 22043, assessmentId: 1, year: 2020
      }]
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
      ['panthera tigris', { name: 'panthera tigris', taxonId: 15955, assessmentId: 214862019, year: 2022 }]
    ])
    const a = mergeIdsIntoSpeciesData(data, ids, new Map(), meta)
    const b = mergeIdsIntoSpeciesData(a, ids, new Map(), meta)
    assert.deepEqual(a, b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scripts/build-iucn-link-id.test.js`
Expected: FAIL — `mergeIdsIntoSpeciesData is not exported`.

- [ ] **Step 3: Implement `mergeIdsIntoSpeciesData`**

Append to `scripts/build-iucn-link-id.lib.js`:

```js
const THREATENED_CODES = new Set(['VU', 'EN', 'CR'])

/**
 * Merge IUCN public IDs into the data.json species map.
 *
 * - Only VU/EN/CR entries are eligible for IUCN ID enrichment.
 * - For each eligible entry, try a direct binomial match first, then the
 *   alias map (label → binomial).
 * - When matched, set both `iucnTaxonId` and `iucnAssessmentId`.
 * - When unmatched, strip both fields (so reruns after a removal upstream
 *   are idempotent and never leave stale IDs behind).
 * - Two top-level metadata keys (`_iucnSourceVersion`, `_iucnRefreshedAt`)
 *   are written each run.
 *
 * Pure function — does no I/O. Returns a new object; does not mutate input.
 *
 * @param {Record<string, object>} data       existing data.json map (may include _iucn* keys)
 * @param {Map<string, {taxonId:number, assessmentId:number}>} ids    binomial → ID map
 * @param {Map<string, string>} aliases       label → binomial alias map
 * @param {{ sourceVersion: string, refreshedAt: string }} meta
 */
export function mergeIdsIntoSpeciesData(data, ids, aliases, meta) {
  const out = {
    _iucnSourceVersion: meta.sourceVersion,
    _iucnRefreshedAt: meta.refreshedAt
  }
  for (const [key, entry] of Object.entries(data)) {
    if (key.startsWith('_')) continue // skip prior metadata; we rewrote it above
    if (!THREATENED_CODES.has(entry?.iucn)) {
      out[key] = entry
      continue
    }

    const direct = ids.get(key)
    const aliased = !direct && aliases.has(key) ? ids.get(aliases.get(key)) : null
    const match = direct || aliased

    if (match) {
      out[key] = { ...entry, iucnTaxonId: match.taxonId, iucnAssessmentId: match.assessmentId }
    } else {
      // Strip stale IDs so reruns stay idempotent after a name is removed
      // from the IUCN export.
      const { iucnTaxonId: _t, iucnAssessmentId: _a, ...rest } = entry
      out[key] = rest
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scripts/build-iucn-link-id.test.js`
Expected: PASS — 16 tests passing total.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-iucn-link-id.lib.js test/scripts/build-iucn-link-id.test.js
git commit -m "feat(scripts): mergeIdsIntoSpeciesData — idempotent ID merge

Pure-function merge of the parsed IUCN map into the data.json shape.
Honors the alias map (snake_case label → binomial), strips stale IDs
on rerun, and writes the _iucnSourceVersion / _iucnRefreshedAt
metadata keys at the top level."
```

---

### Task 6: Wire up the CLI entrypoint and run it

**Files:**
- Create: `scripts/build-iucn-link-id.js`
- Modify: `package.json`
- Modify: `src/shared/speciesInfo/data.json` (output of running the script)

- [ ] **Step 1: Write the entrypoint**

Create `scripts/build-iucn-link-id.js`:

```js
#!/usr/bin/env node
/**
 * Build the IUCN link IDs into src/shared/speciesInfo/data.json.
 *
 * Reads assessments.csv from a gitignored IUCN bulk export folder, keeps
 * only the public identifiers for VU/EN/CR rows, and merges them into the
 * existing data.json. No rationale text or other Red List text fields are
 * written into the repo or the bundled app — see IUCN T&C section 4 and
 * the design doc at docs/specs/2026-05-02-iucn-rationale-overview-design.md.
 *
 * Usage:
 *   npm run iucn-link-id:build -- [--from <path>] [--version <id>]
 *
 *   --from <path>     IUCN export folder. Default: most recent
 *                     data/redlist_species_data_* folder.
 *   --version <id>    Source version label written to _iucnSourceVersion
 *                     (e.g. "2025-1"). Default: inferred from folder name,
 *                     else the folder's mtime as YYYY-MM-DD.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import csvParser from 'csv-parser'

import { buildAliasMap } from './lib/aliases.js'
import {
  parseRedlistRow,
  pickLatestPerTaxon,
  mergeIdsIntoSpeciesData
} from './build-iucn-link-id.lib.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'data')
const OUTPUT_PATH = path.join(ROOT, 'src/shared/speciesInfo/data.json')

function parseArgs(argv) {
  const out = { from: null, version: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--from') out.from = argv[++i]
    else if (a === '--version') out.version = argv[++i]
    else throw new Error(`unknown flag: ${a}`)
  }
  return out
}

/**
 * Find the most recent data/redlist_species_data_* folder.
 * Folders are uuid-suffixed; we pick by mtime.
 */
function findLatestExport() {
  if (!fs.existsSync(DATA_DIR)) return null
  const candidates = fs
    .readdirSync(DATA_DIR)
    .filter((n) => n.startsWith('redlist_species_data_'))
    .map((n) => {
      const full = path.join(DATA_DIR, n)
      const stat = fs.statSync(full)
      return { name: n, full, mtime: stat.mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
  return candidates[0] || null
}

function inferSourceVersion(folder) {
  // Try to extract a "YYYY-N" or similar version tag from the folder name;
  // fall back to the folder's mtime as an ISO date.
  const m = folder.name.match(/(\d{4}-\d+)/)
  if (m) return m[1]
  return new Date(folder.mtime).toISOString().slice(0, 10)
}

async function streamRows(csvPath) {
  return new Promise((resolve, reject) => {
    const rows = []
    fs.createReadStream(csvPath)
      .pipe(csvParser())
      .on('data', (row) => {
        const parsed = parseRedlistRow(row)
        if (parsed) rows.push(parsed)
      })
      .on('end', () => resolve(rows))
      .on('error', reject)
  })
}

function loadData() {
  const text = fs.readFileSync(OUTPUT_PATH, 'utf8')
  return JSON.parse(text)
}

function writeData(data) {
  // Sort species keys alphabetically for stable diffs; metadata keys (with
  // leading underscore) bubble to the top via natural string ordering.
  const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)))
  const tmp = `${OUTPUT_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, OUTPUT_PATH)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  let folder
  if (args.from) {
    const stat = fs.statSync(args.from)
    folder = { name: path.basename(args.from), full: args.from, mtime: stat.mtimeMs }
  } else {
    folder = findLatestExport()
    if (!folder) {
      console.error(
        `No IUCN export found at ${DATA_DIR}/redlist_species_data_*. ` +
          `Download a Red List bulk export (filtered to VU/EN/CR) from ` +
          `iucnredlist.org and place it in data/, or pass --from <path>.`
      )
      process.exit(1)
    }
  }

  const csvPath = path.join(folder.full, 'assessments.csv')
  if (!fs.existsSync(csvPath)) {
    console.error(`Missing assessments.csv in ${folder.full}`)
    process.exit(1)
  }

  console.log(`Reading ${csvPath}`)
  const rows = await streamRows(csvPath)
  console.log(`Parsed ${rows.length} VU/EN/CR rows from CSV`)

  const ids = pickLatestPerTaxon(rows)
  console.log(`Collapsed to ${ids.size} unique taxa`)

  const aliases = buildAliasMap()
  const data = loadData()
  const meta = {
    sourceVersion: args.version || inferSourceVersion(folder),
    refreshedAt: new Date().toISOString().slice(0, 10)
  }
  const merged = mergeIdsIntoSpeciesData(data, ids, aliases, meta)

  // Summary
  const threatenedKeys = Object.entries(merged).filter(
    ([k, v]) => !k.startsWith('_') && ['VU', 'EN', 'CR'].includes(v?.iucn)
  )
  const matched = threatenedKeys.filter(([, v]) => v.iucnTaxonId).length
  const unmatched = threatenedKeys.filter(([, v]) => !v.iucnTaxonId).map(([k]) => k)
  console.log(`\n=== summary ===`)
  console.log(`source version : ${meta.sourceVersion}`)
  console.log(`refreshed at   : ${meta.refreshedAt}`)
  console.log(`threatened     : ${threatenedKeys.length}`)
  console.log(`matched        : ${matched} (${Math.round((100 * matched) / threatenedKeys.length)}%)`)
  console.log(`unmatched      : ${unmatched.length}`)
  if (unmatched.length) console.log(`  sample: ${unmatched.slice(0, 8).join(', ')}`)

  writeData(merged)
  console.log(`\nwrote ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Add the npm script**

In `package.json`, find the `species-info:build` line and add a sibling immediately after it:

```json
"iucn-link-id:build": "node scripts/build-iucn-link-id.js",
```

- [ ] **Step 3: Run the script for the first time**

Run: `npm run iucn-link-id:build`
Expected: prints a summary like:

```
Reading data/redlist_species_data_<uuid>/assessments.csv
Parsed ~9000 VU/EN/CR rows from CSV
Collapsed to ~9000 unique taxa

=== summary ===
source version : 2025-1                  (or similar, depending on folder)
refreshed at   : 2026-05-02
threatened     : 288
matched        : ≥260 (~90%)
unmatched      : ≤28
  sample: tarsius bancanus, hatinh_langur, ...

wrote .../src/shared/speciesInfo/data.json
```

If `matched` < 260, stop and investigate — check that the export folder is in `data/`, the alias map test passes, and a sample binomial like `panthera tigris` does land in `ids` (drop a temporary `console.log` if needed).

- [ ] **Step 4: Sanity-check the diff**

Run: `git diff --stat src/shared/speciesInfo/data.json`
Expected: a non-trivial modification (additions + small reordering due to sort, plus the two new top-level keys).

Run: `head -5 src/shared/speciesInfo/data.json`
Expected: the first lines show `_iucnRefreshedAt` and `_iucnSourceVersion` (or the alphabetically-first entries — depending on locale ordering, the underscore-prefixed keys may sort first or last).

Run a sanity grep:

```bash
grep -c "iucnTaxonId" src/shared/speciesInfo/data.json
```

Expected: ≥260.

- [ ] **Step 5: Run the script a second time and confirm the diff is empty**

Run: `npm run iucn-link-id:build && git diff --stat src/shared/speciesInfo/data.json`
Expected: only the `_iucnRefreshedAt` line changes (or it's stable if same date) — no per-species changes. Idempotency holds.

If the date is the same as the previous run, expect `git diff` to show nothing at all on the second run.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-iucn-link-id.js package.json src/shared/speciesInfo/data.json
git commit -m "feat(scripts): add IUCN link-id builder and run it once

CLI entrypoint that streams data/redlist_species_data_*/assessments.csv,
keeps only public IDs for VU/EN/CR rows, and merges them into the
committed data.json. Idempotent — second run is a no-op (modulo the
_iucnRefreshedAt date stamp).

Per IUCN T&C section 4, no rationale text, summaries, or other Red List
text fields are written into the repo or the bundled app."
```

---

### Task 7: Update the resolver JSDoc

The resolver already passes through unknown fields, so no logic changes — just document the new shape.

**Files:**
- Modify: `src/shared/speciesInfo/resolver.js`

- [ ] **Step 1: Open the resolver and find the @returns line**

Run: `grep -n "@returns" src/shared/speciesInfo/resolver.js`
Expected: a single line near the top of the file's JSDoc, currently listing `iucn`, `blurb`, `imageUrl`, `wikipediaUrl`.

- [ ] **Step 2: Extend the JSDoc to include the two new fields**

Replace the `@returns` line with:

```
 * @returns {{ iucn?: string, blurb?: string, imageUrl?: string, wikipediaUrl?: string, iucnTaxonId?: number, iucnAssessmentId?: number } | null}
```

- [ ] **Step 3: Verify the resolver still works with the new metadata keys**

The resolver's body looks species up by name (lowercase scientific name). Top-level keys starting with `_` (like `_iucnSourceVersion`) are valid object keys but are never queried by the resolver since no species has a name starting with `_`. No code change needed.

Confirm by running the existing test suite:

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/shared/speciesInfo/resolver.js
git commit -m "docs(species-info): document new IUCN link-id fields in JSDoc"
```

---

### Task 8: Add IUCN left-bar accent color map

The existing `IucnBadge` palette uses background colors for the badge chip. The new "Why threatened?" CTA needs a slightly different style of accent — a Tailwind border color for the left edge — so we add a small parallel map. Keep it next to the badge so future palette changes happen in one place.

**Files:**
- Modify: `src/renderer/src/ui/IucnBadge.jsx`

- [ ] **Step 1: Add and export the accent color map**

Open `src/renderer/src/ui/IucnBadge.jsx` and append to the bottom of the file (after the default export):

```js
// Left-edge accent for the "Why threatened?" CTA in the species hover card.
// Only meaningful for the threatened categories — others are not click-out
// targets to the IUCN Red List.
export const IUCN_ACCENT_BORDER = {
  VU: 'border-orange-300',
  EN: 'border-red-300',
  CR: 'border-red-400'
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build` (or `npm run dev` if a dev server is already running — the build will fail fast on syntax errors).
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/IucnBadge.jsx
git commit -m "feat(ui): add IUCN accent-border palette for threatened CTA"
```

---

### Task 9: Render the "Why threatened?" CTA in `SpeciesTooltipContent`

This is the user-facing change. When the resolved species info has an `iucnTaxonId`, render a clickable CTA block above the Wikipedia blurb with a left-edge accent in the IUCN category color, and demote the Wikipedia "About" section.

**Files:**
- Modify: `src/renderer/src/ui/SpeciesTooltipContent.jsx`

- [ ] **Step 1: Import the accent palette**

Near the existing `IucnBadge` import at the top of `SpeciesTooltipContent.jsx`, change:

```jsx
import IucnBadge from './IucnBadge'
```

to:

```jsx
import IucnBadge, { IUCN_ACCENT_BORDER } from './IucnBadge'
```

- [ ] **Step 2: Compute the IUCN URL**

Inside the component body, after the `info` resolution (around line 51 where `const info = resolveSpeciesInfo(sciName)` is defined), add:

```jsx
const iucnUrl =
  info?.iucnTaxonId && info?.iucnAssessmentId
    ? `https://www.iucnredlist.org/species/${info.iucnTaxonId}/${info.iucnAssessmentId}`
    : null
```

- [ ] **Step 3: Render the CTA block**

In the JSX, between the name+badge row (currently inside the footer `div`) and the existing Wikipedia blurb block, insert:

```jsx
{iucnUrl && (
  <a
    href={iucnUrl}
    target="_blank"
    rel="noopener noreferrer"
    className={`block border-l-4 ${IUCN_ACCENT_BORDER[info.iucn] ?? 'border-gray-300'} pl-2 -ml-0.5 py-1 hover:bg-gray-100 rounded-r transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300`}
  >
    <p className={`${blurbClass} font-semibold text-gray-800`}>Why threatened?</p>
    <p className={`${linkClass} text-blue-600`}>View IUCN Red List assessment ↗</p>
  </a>
)}
```

`target="_blank"` is intentional — `setWindowOpenHandler` in `src/main/app/lifecycle.js:57-60` intercepts new-window requests and routes them through `shell.openExternal`. That's the same path used by the existing "Read on Wikipedia" link.

- [ ] **Step 4: Leave the Wikipedia blurb rendering unchanged**

No edit to the existing `{info?.blurb && (...)}` block. Both the IUCN CTA and the Wikipedia "About" text stay useful — the CTA explains *why threatened*, the Wikipedia blurb gives general species context. The user keeps the existing `Show more` / `Show less` toggle and "Read on Wikipedia" link exactly as they are today.

- [ ] **Step 5: Update the `if (!imageSource && ...)` early-return to consider the new field**

Currently the component returns `null` if there's nothing to show. Find the line:

```jsx
if (!imageSource && !info?.blurb && !info?.iucn && !sciName) {
  return null
}
```

It already covers the case (the CTA only renders when `info.iucnTaxonId` is set, which implies `info.iucn` is one of VU/EN/CR, which is truthy). No change needed — but double-check by reading the line.

- [ ] **Step 6: Build and lint**

Run: `npm run build`
Expected: build succeeds, no React/Tailwind warnings about unknown classes.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/ui/SpeciesTooltipContent.jsx
git commit -m "feat(ui): show IUCN Red List CTA on threatened species hover

Adds a 'Why threatened?' click-through above the Wikipedia blurb when
the species is VU/EN/CR. The block opens the canonical IUCN species
page in the user's default browser via the existing setWindowOpenHandler
pipeline. The Wikipedia 'About' blurb stays unchanged so users still
get the general species context alongside the threat-status link."
```

---

### Task 10: Smoke-test the UI manually

Skim the actual hover behavior in a running app — type checks and unit tests don't catch layout regressions or click-handler conflicts.

**Files:** none (testing only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Electron window opens.

- [ ] **Step 2: Navigate to a study with threatened species**

Open any study that has detections of a species the team knows is VU/EN/CR (e.g., Sun Bear, Tiger, Giant Panda). Go to the Overview tab. The species distribution list shows IUCN badges next to row names.

- [ ] **Step 3: Hover a threatened species row**

Hover the name of a VU/EN/CR row. Confirm:
- [ ] Tooltip opens within ~200ms (existing behavior).
- [ ] "Why threatened?" CTA block is visible **above** the Wikipedia blurb.
- [ ] Left-edge bar color matches the species' IUCN category (orange for VU, red for EN/CR).
- [ ] "View IUCN Red List assessment ↗" link text shows below the heading.
- [ ] Wikipedia blurb still renders at full size with its "Show more" toggle and "Read on Wikipedia" link — unchanged from before.

- [ ] **Step 4: Click the CTA**

Click anywhere inside the "Why threatened?" block. Confirm:
- [ ] Default browser opens.
- [ ] URL is `https://www.iucnredlist.org/species/<id>/<assessmentId>`.
- [ ] The page loads the correct species' assessment.

- [ ] **Step 5: Click somewhere else on the row**

With the tooltip open, click the species name (outside the tooltip, on the row's actual button). Confirm:
- [ ] App navigates to `/study/<id>/media?species=<scientific>`.
- [ ] No navigation to IUCN happened.

- [ ] **Step 6: Hover a Least-Concern species row**

Find a row with category LC (e.g., raccoon, deer in most studies). Hover. Confirm:
- [ ] No "Why threatened?" CTA appears.
- [ ] Wikipedia blurb is full-size with "Show more" if long — same as before this work.

- [ ] **Step 7: Hover a row with no data.json entry**

Find a row whose scientific name isn't in `data.json` (something like a unique mis-spelling). Confirm:
- [ ] Tooltip falls back to the existing minimal layout (image only, or no tooltip if no image either).
- [ ] No console errors about missing fields.

- [ ] **Step 8: Stop the dev server**

`Ctrl+C` in the terminal.

- [ ] **Step 9: Document the smoke-test result in the commit**

If anything from steps 3-7 didn't behave as expected, fix it before continuing. If everything passed, no code change here — just move on.

No commit for this task (no code changes). If a fix was required, commit that separately under a `fix(ui):` prefix.

---

### Task 11: Document the new build script and `data/` convention

**Files:**
- Modify: `docs/development.md`

- [ ] **Step 1: Find an appropriate section in `docs/development.md`**

Run: `grep -n "^##" docs/development.md | head -20`

Look for a section header like "Build scripts", "Species enrichment", "Data files", or similar. If none exists, add a new "## IUCN Red List link IDs" section near the existing species-info documentation.

- [ ] **Step 2: Add the documentation block**

Insert this section in the appropriate place (replace `<section anchor>` placement based on step 1):

```markdown
## IUCN Red List link IDs

The species hover card on the Overview tab includes a click-through to the
official IUCN Red List assessment page for species classified as Vulnerable,
Endangered, or Critically Endangered. The required IDs (`iucnTaxonId` and
`iucnAssessmentId`) are baked into `src/shared/speciesInfo/data.json` by a
build script that reads from a gitignored bulk export.

### Why a bulk export instead of the API?

The IUCN T&C (Section 4) prohibit redistribution of Red List Data — including
inside a derivative app — without a written waiver. The committed `data.json`
deliberately stores only the public numeric identifiers (which the IUCN URL
already exposes), never rationale text, criteria strings, threats lists, or
any other CSV text field. Section 3 explicitly carves out the IUCN Categories
themselves (VU/EN/CR/...) as freely usable, which is what we already display
on the badges.

### Refreshing the link IDs

1. Sign in at https://www.iucnredlist.org and run a search filtered to
   Red List Category = Vulnerable, Endangered, Critically Endangered.
2. Use "Download → Search Results". You'll get an emailed link to a zip.
3. Unzip into `data/`, ending up with `data/redlist_species_data_<uuid>/`.
   The folder is gitignored.
4. From the repo root, run:

   ```
   npm run iucn-link-id:build
   ```

   The script picks up the most recent `data/redlist_species_data_*` folder
   automatically. Override with `--from <path>` if needed.

5. Optionally pass `--version 2025-1` (or whatever Red List version you
   downloaded) so `_iucnSourceVersion` in `data.json` is human-readable.
   When omitted, the script infers a version from the folder name or
   falls back to the folder's mtime as YYYY-MM-DD.

6. Commit the resulting `data.json` diff. Two top-level metadata keys
   (`_iucnSourceVersion` and `_iucnRefreshedAt`) record provenance.

The script is idempotent — running it twice in a row produces an identical
`data.json` (modulo the `_iucnRefreshedAt` timestamp).

### Refresh cadence

IUCN publishes new Red List versions roughly once or twice a year. Refresh
when a new version drops or when a new threatened species is added to the
camera-trap dictionaries shipped with Biowatch.
```

- [ ] **Step 2: Verify the markdown renders**

Run: `cat docs/development.md | head -100`
Expected: visually inspect the new section reads cleanly.

- [ ] **Step 3: Commit**

```bash
git add docs/development.md
git commit -m "docs(development): document IUCN link-id build script and data/ folder"
```

---

## Verification — final pass

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 3: Visual smoke test once more**

Repeat Task 10 quickly to make sure nothing regressed since.

- [ ] **Step 4: Verify no IUCN prose leaked**

Run a grep across the repo to make sure no rationale text or other CSV-only fields snuck into the bundle:

```bash
grep -rE "iucnRationale|redlistCriteria|populationTrend|conservationActions" src/ scripts/ test/ docs/ 2>/dev/null
```

Expected: only matches in comments/docs that explicitly call out we *don't* bundle these. If actual data values appear, stop and remove them — that's a Phase 2 concern, not Phase 1.

- [ ] **Step 5: Verify the gitignore held**

Run: `git status && git ls-files data/`
Expected: only `data/.gitkeep` is tracked. The `redlist_species_data_*/` folder is not in `git status` (untracked is fine; tracked is not).

---

## Out of scope for this plan

These belong to Phase 2 (gated on an IUCN Section 4 waiver — see the design doc):

- Bundling rationale text, criteria strings, population trend, threats, or any other text fields.
- Inline rationale rendering with line-clamp-6 + "Show more".
- Attribution footer ("Source: IUCN Red List, <year> assessment").

These are explicitly *not* started in this plan; the file-touch list and acceptance criteria are scoped to Phase 1 only.
