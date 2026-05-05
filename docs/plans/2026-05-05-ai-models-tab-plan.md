# AI Models tab — geographic-scope redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat AI Models table in Settings with a split view: an interactive Leaflet map showing each model's coverage zone on the left, a model list with browsable species data on the right.

**Architecture:** Decompose the monolithic `Zoo` component into 6 single-responsibility components (`MlZoo`, `MapPane`, `ModelListPane`, `ModelCard`, `SpeciesPanel`, `CustomModelCard`) plus one hook (`useResponsiveLayout`). Extend the existing `modelZoo` registry with `region` and `species_count` fields; ship region GeoJSON and per-model species JSON as static assets. No IPC changes — reuse all existing `model:*` handlers.

**Tech Stack:** React 19, Tailwind CSS 4, react-leaflet 5, lucide-react, @tanstack/react-query, sonner. Tests use `node:test` from the test/ directory.

**Spec:** [`docs/specs/2026-05-05-ai-models-tab-design.md`](../specs/2026-05-05-ai-models-tab-design.md)

---

## File Structure

**New files (renderer components):**
- `src/renderer/src/models/index.jsx` — `MlZoo` top-level
- `src/renderer/src/models/MapPane.jsx` — Leaflet map + region overlays + worldwide chip
- `src/renderer/src/models/ModelListPane.jsx` — ordered list container
- `src/renderer/src/models/ModelCard.jsx` — one card, all states
- `src/renderer/src/models/SpeciesPanel.jsx` — chip-list or grouped variants
- `src/renderer/src/models/CustomModelCard.jsx` — static contact CTA
- `src/renderer/src/models/useResponsiveLayout.js` — width-breakpoint hook
- `src/renderer/src/models/regions.js` — region color/label registry + helpers

**New files (data):**
- `src/shared/regions/europe.geojson`
- `src/shared/regions/himalayas.geojson`
- `src/shared/species/speciesnet.json`
- `src/shared/species/deepfaune.json`
- `src/shared/species/manas.json`

**New files (tests):**
- `test/renderer/regions.test.js`
- `test/renderer/speciesPanelHelpers.test.js`

**New files (helpers):**
- `src/renderer/src/models/speciesPanelHelpers.js` — pure functions for grouping/filtering species

**Modified:**
- `src/shared/mlmodels.js` — add `region` and `species_count` to each model
- `src/renderer/src/settings.jsx:6` — change `import Zoo from './models'` to `import MlZoo from './models'` (the default export now lives at `models/index.jsx`)
- `src/renderer/src/settings.jsx:142` — replace `<Zoo modelZoo={modelZoo} />` with `<MlZoo modelZoo={modelZoo} />`

**Deleted:**
- `src/renderer/src/models.jsx` (replaced by `src/renderer/src/models/index.jsx`)

---

## Task 1: Region registry + color helpers

Pure-data module that maps region IDs to labels, colors, and GeoJSON paths. TDD because color helpers (`withAlpha`) need to be predictable.

**Files:**
- Create: `src/renderer/src/models/regions.js`
- Test: `test/renderer/regions.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/renderer/regions.test.js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  REGIONS,
  getRegion,
  withAlpha
} from '../../src/renderer/src/models/regions.js'

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
    assert.equal(REGIONS.europe.geojson, 'europe.geojson')
    assert.equal(REGIONS.himalayas.geojson, 'himalayas.geojson')
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/renderer/regions.test.js`
Expected: FAIL with `Cannot find module '../../src/renderer/src/models/regions.js'`

- [ ] **Step 3: Implement the module**

```js
// src/renderer/src/models/regions.js
export const REGIONS = {
  worldwide: {
    id: 'worldwide',
    label: 'Worldwide',
    color: '#6366f1',
    badgeBg: '#e0e7ff',
    badgeText: '#4338ca',
    geojson: null
  },
  europe: {
    id: 'europe',
    label: 'Europe',
    color: '#047857',
    badgeBg: '#d1fae5',
    badgeText: '#047857',
    geojson: 'europe.geojson'
  },
  himalayas: {
    id: 'himalayas',
    label: 'Himalayas',
    color: '#be185d',
    badgeBg: '#fce7f3',
    badgeText: '#be185d',
    geojson: 'himalayas.geojson'
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    color: '#a855f7',
    badgeBg: '#f3e8ff',
    badgeText: '#6b21a8',
    geojson: null
  }
}

export function getRegion(id) {
  return REGIONS[id] || null
}

export function withAlpha(hex, alpha) {
  const a = Math.max(0, Math.min(1, alpha))
  const byte = Math.round(a * 255).toString(16).padStart(2, '0')
  return `${hex}${byte}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/renderer/regions.test.js`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/models/regions.js test/renderer/regions.test.js
git commit -m "feat(models): add region registry with colors and geojson refs"
```

---

## Task 2: Extend `modelZoo` with `region` and `species_count`

Add the two new fields on each entry in the existing `modelZoo` array. No new functions, no API changes — just data.

**Files:**
- Modify: `src/shared/mlmodels.js:158-200`

- [ ] **Step 1: Add `region` and `species_count` to SpeciesNet**

Edit `src/shared/mlmodels.js`. Find the SpeciesNet entry (around line 158) and add the two fields just before the closing `}`:

```js
{
  reference: { id: 'speciesnet', version: '4.0.1a' },
  pythonEnvironment: { id: 'common', version: '0.1.4' },
  name: 'SpeciesNet',
  size_in_MB: 468,
  files: 6,
  downloadURL:
    'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.1a.tar.gz?download=true',
  description:
    "Google's SpeciesNet is an open-source AI model launched in 2025, specifically designed for identifying animal species from images captured by camera traps. It boasts the capability to classify images into over 2,000 species labels, greatly enhancing the efficiency of wildlife data analysis for conservation initiatives.",
  website: 'https://github.com/google/cameratrapai',
  logo: 'google',
  detectionConfidenceThreshold: 0.5,
  region: 'worldwide',
  species_count: '2,000+',
  species_data: 'speciesnet.json'
}
```

- [ ] **Step 2: Add `region` and `species_count` to DeepFaune**

```js
{
  reference: { id: 'deepfaune', version: '1.3' },
  // …existing fields…
  detectionConfidenceThreshold: 0.5,
  region: 'europe',
  species_count: 26,
  species_data: 'deepfaune.json'
}
```

- [ ] **Step 3: Add `region` and `species_count` to Manas**

```js
{
  reference: { id: 'manas', version: '1.0' },
  // …existing fields…
  detectionConfidenceThreshold: 0.5,
  region: 'himalayas',
  species_count: 11,
  species_data: 'manas.json'
}
```

- [ ] **Step 4: Verify nothing else broke**

Run: `node --test test/shared/`
Expected: existing shared-module tests still pass (no failures introduced by the field additions).

- [ ] **Step 5: Commit**

```bash
git add src/shared/mlmodels.js
git commit -m "feat(mlmodels): add region and species_count fields"
```

---

## Task 3: Species data files

Three static JSON files, one per model. Schema follows the spec.

**Files:**
- Create: `src/shared/species/deepfaune.json`
- Create: `src/shared/species/manas.json`
- Create: `src/shared/species/speciesnet.json`

- [ ] **Step 1: Create `deepfaune.json`**

```json
{
  "species": [
    { "common": "Red fox", "scientific": "Vulpes vulpes" },
    { "common": "European badger", "scientific": "Meles meles" },
    { "common": "Wild boar", "scientific": "Sus scrofa" },
    { "common": "Roe deer", "scientific": "Capreolus capreolus" },
    { "common": "Red deer", "scientific": "Cervus elaphus" },
    { "common": "Eurasian lynx", "scientific": "Lynx lynx" },
    { "common": "Grey wolf", "scientific": "Canis lupus" },
    { "common": "Brown bear", "scientific": "Ursus arctos" },
    { "common": "European hare", "scientific": "Lepus europaeus" },
    { "common": "European rabbit", "scientific": "Oryctolagus cuniculus" },
    { "common": "Pine marten", "scientific": "Martes martes" },
    { "common": "Beech marten", "scientific": "Martes foina" },
    { "common": "European polecat", "scientific": "Mustela putorius" },
    { "common": "Eurasian otter", "scientific": "Lutra lutra" },
    { "common": "Western hedgehog", "scientific": "Erinaceus europaeus" },
    { "common": "Red squirrel", "scientific": "Sciurus vulgaris" },
    { "common": "European beaver", "scientific": "Castor fiber" },
    { "common": "Wildcat", "scientific": "Felis silvestris" },
    { "common": "Domestic cat", "scientific": "Felis catus" },
    { "common": "Domestic dog", "scientific": "Canis familiaris" },
    { "common": "Common chamois", "scientific": "Rupicapra rupicapra" },
    { "common": "Alpine ibex", "scientific": "Capra ibex" },
    { "common": "Mouflon", "scientific": "Ovis orientalis" },
    { "common": "Mountain hare", "scientific": "Lepus timidus" },
    { "common": "Capercaillie", "scientific": "Tetrao urogallus" },
    { "common": "Wood mouse", "scientific": "Apodemus sylvaticus" }
  ]
}
```

> Note: this list is a starting set for v1. Confirm against the official DeepFaune v1.3 label file before final merge — the count should match `species_count: 26` in `mlmodels.js`. If the upstream list differs, update both this file and `mlmodels.js` consistently.

- [ ] **Step 2: Create `manas.json`**

```json
{
  "species": [
    { "common": "Snow leopard", "scientific": "Panthera uncia" },
    { "common": "Grey wolf", "scientific": "Canis lupus" },
    { "common": "Red fox", "scientific": "Vulpes vulpes" },
    { "common": "Eurasian lynx", "scientific": "Lynx lynx" },
    { "common": "Pallas's cat", "scientific": "Otocolobus manul" },
    { "common": "Brown bear", "scientific": "Ursus arctos" },
    { "common": "Stone marten", "scientific": "Martes foina" },
    { "common": "Siberian ibex", "scientific": "Capra sibirica" },
    { "common": "Argali sheep", "scientific": "Ovis ammon" },
    { "common": "Marmot", "scientific": "Marmota baibacina" },
    { "common": "Tolai hare", "scientific": "Lepus tolai" }
  ]
}
```

> Note: this list is a starting set. Confirm against OSI-Panthera's official Manas v1.0 label file before final merge.

- [ ] **Step 3: Create `speciesnet.json` placeholder**

For v1, ship a structured placeholder that the SpeciesPanel can render (taxonomic class summary) without the full 2,000-species list. The full list will be wired in a follow-up once Google's labels file is processed.

```json
{
  "species": [],
  "summary": {
    "total": 2000,
    "classes": [
      { "id": "mammal",    "label": "Mammals",       "icon": "🦌", "approx_count": 480 },
      { "id": "bird",      "label": "Birds",         "icon": "🦅", "approx_count": 1200 },
      { "id": "reptile",   "label": "Reptiles",      "icon": "🦎", "approx_count": 180 },
      { "id": "amphibian", "label": "Amphibians",    "icon": "🐸", "approx_count": 90 },
      { "id": "other",     "label": "Fish & other",  "icon": "🐟", "approx_count": 70 }
    ]
  }
}
```

> The `summary` object lets SpeciesPanel render the grouped view without iterating over 2,000 entries. When the full list is available, populate `species` with `{ common, scientific, class }` entries and the panel will switch from approx counts to derived counts (the helper in Task 5 handles both).

- [ ] **Step 4: Commit**

```bash
git add src/shared/species/
git commit -m "feat(species): add per-model species data files"
```

---

## Task 4: Region GeoJSON files

Static polygon data for the map overlays. Sourced from Natural Earth Admin-0 boundaries (CC0 licensed).

**Files:**
- Create: `src/shared/regions/europe.geojson`
- Create: `src/shared/regions/himalayas.geojson`
- Create: `src/shared/regions/README.md`

- [ ] **Step 1: Document the source**

```markdown
<!-- src/shared/regions/README.md -->
# Region GeoJSON files

Polygons for AI model coverage zones rendered in the AI Models tab map.

## Source

Natural Earth Admin-0 country boundaries, 110m resolution (CC0 license).
Download: https://www.naturalearthdata.com/downloads/110m-cultural-vectors/

## Processing

Files are pre-processed (filtered to relevant countries, simplified with
mapshaper at ~5% retention) to keep bundle size small.

## Files

- `europe.geojson` — union of European country boundaries (excluding
  Russia east of the Urals; including Cyprus and Malta).
- `himalayas.geojson` — Kyrgyzstan boundary. Replace with a broader
  high-altitude Central Asian polygon if the model authors prefer.

## Updating

1. Download `ne_110m_admin_0_countries.geojson` from Natural Earth.
2. In mapshaper: filter by `CONTINENT == "Europe"` (or by ISO_A2 list),
   simplify to ~5%, export as GeoJSON, save as `europe.geojson`.
3. Repeat for Kyrgyzstan: `filter "ISO_A2 == 'KG'"`.
4. Verify the result loads in the map (Task 11) and looks correct.
```

- [ ] **Step 2: Create `europe.geojson` placeholder**

For v1, ship a simple bounding-box polygon as a placeholder. Replace with real Natural Earth data in a follow-up commit (the README documents the process).

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Europe (placeholder bbox)" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [-10.5, 35.0],
          [40.0, 35.0],
          [40.0, 71.0],
          [-10.5, 71.0],
          [-10.5, 35.0]
        ]]
      }
    }
  ]
}
```

- [ ] **Step 3: Create `himalayas.geojson` placeholder**

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Kyrgyzstan (placeholder bbox)" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [69.3, 39.2],
          [80.3, 39.2],
          [80.3, 43.3],
          [69.3, 43.3],
          [69.3, 39.2]
        ]]
      }
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/regions/
git commit -m "feat(regions): add placeholder geojson for europe and himalayas"
```

> Real Natural Earth polygons can replace the placeholders in a follow-up commit without touching any other code — the GeoJSON shape is the contract.

---

## Task 5: Species panel helpers (pure logic, TDD)

Three pure functions: filter species by query string, group species by taxonomic class, derive class summary from species data.

**Files:**
- Create: `src/renderer/src/models/speciesPanelHelpers.js`
- Test: `test/renderer/speciesPanelHelpers.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/renderer/speciesPanelHelpers.test.js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  filterSpecies,
  classSummary
} from '../../src/renderer/src/models/speciesPanelHelpers.js'

const sampleSpecies = [
  { common: 'Red fox', scientific: 'Vulpes vulpes', class: 'mammal' },
  { common: 'Grey wolf', scientific: 'Canis lupus', class: 'mammal' },
  { common: 'Capercaillie', scientific: 'Tetrao urogallus', class: 'bird' }
]

describe('filterSpecies', () => {
  test('returns all species when query is empty', () => {
    assert.equal(filterSpecies(sampleSpecies, '').length, 3)
    assert.equal(filterSpecies(sampleSpecies, '   ').length, 3)
  })

  test('matches common name (case-insensitive)', () => {
    const out = filterSpecies(sampleSpecies, 'fox')
    assert.equal(out.length, 1)
    assert.equal(out[0].common, 'Red fox')
  })

  test('matches scientific name (case-insensitive)', () => {
    const out = filterSpecies(sampleSpecies, 'canis')
    assert.equal(out.length, 1)
    assert.equal(out[0].common, 'Grey wolf')
  })

  test('returns empty when no match', () => {
    assert.equal(filterSpecies(sampleSpecies, 'zzz').length, 0)
  })
})

describe('classSummary', () => {
  test('uses provided summary when species[] is empty', () => {
    const data = {
      species: [],
      summary: {
        total: 100,
        classes: [
          { id: 'mammal', label: 'Mammals', icon: '🦌', approx_count: 60 },
          { id: 'bird', label: 'Birds', icon: '🦅', approx_count: 40 }
        ]
      }
    }
    const out = classSummary(data)
    assert.equal(out.total, 100)
    assert.equal(out.classes.length, 2)
    assert.equal(out.classes[0].count, 60)
    assert.equal(out.classes[0].approximate, true)
  })

  test('derives counts from species[] when present', () => {
    const data = { species: sampleSpecies }
    const out = classSummary(data)
    assert.equal(out.total, 3)
    const mammals = out.classes.find((c) => c.id === 'mammal')
    assert.equal(mammals.count, 2)
    assert.equal(mammals.approximate, false)
    const birds = out.classes.find((c) => c.id === 'bird')
    assert.equal(birds.count, 1)
  })

  test('returns null classes for species without a class field', () => {
    const data = {
      species: [{ common: 'Red fox', scientific: 'Vulpes vulpes' }]
    }
    const out = classSummary(data)
    assert.equal(out.classes, null)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/renderer/speciesPanelHelpers.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the helpers**

```js
// src/renderer/src/models/speciesPanelHelpers.js

const CLASS_DEFAULTS = {
  mammal:    { label: 'Mammals',    icon: '🦌' },
  bird:      { label: 'Birds',      icon: '🦅' },
  reptile:   { label: 'Reptiles',   icon: '🦎' },
  amphibian: { label: 'Amphibians', icon: '🐸' },
  other:     { label: 'Other',      icon: '🐟' }
}

export function filterSpecies(species, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return species
  return species.filter(
    (s) =>
      s.common.toLowerCase().includes(q) ||
      (s.scientific && s.scientific.toLowerCase().includes(q))
  )
}

export function classSummary(data) {
  const list = data.species || []

  if (list.length === 0 && data.summary) {
    return {
      total: data.summary.total,
      classes: data.summary.classes.map((c) => ({
        id: c.id,
        label: c.label,
        icon: c.icon,
        count: c.approx_count,
        approximate: true
      }))
    }
  }

  const hasClassField = list.length > 0 && list.every((s) => s.class)
  if (!hasClassField) {
    return { total: list.length, classes: null }
  }

  const counts = new Map()
  for (const s of list) {
    counts.set(s.class, (counts.get(s.class) || 0) + 1)
  }
  const classes = [...counts.entries()].map(([id, count]) => ({
    id,
    label: CLASS_DEFAULTS[id]?.label || id,
    icon: CLASS_DEFAULTS[id]?.icon || '•',
    count,
    approximate: false
  }))

  return { total: list.length, classes }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/renderer/speciesPanelHelpers.test.js`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/models/speciesPanelHelpers.js test/renderer/speciesPanelHelpers.test.js
git commit -m "feat(models): add species panel filter and class-summary helpers"
```

---

## Task 6: Responsive layout hook

A small hook that reports `'split'` (≥ 900 px) or `'stacked'` (< 900 px) based on the window's inner width. No tests — too tightly coupled to `window`; manual verification in the dev server is sufficient.

**Files:**
- Create: `src/renderer/src/models/useResponsiveLayout.js`

- [ ] **Step 1: Implement the hook**

```js
// src/renderer/src/models/useResponsiveLayout.js
import { useEffect, useState } from 'react'

const SPLIT_BREAKPOINT_PX = 900

function compute() {
  if (typeof window === 'undefined') return 'split'
  return window.innerWidth >= SPLIT_BREAKPOINT_PX ? 'split' : 'stacked'
}

export function useResponsiveLayout() {
  const [layout, setLayout] = useState(compute)

  useEffect(() => {
    const onResize = () => setLayout(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return layout
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/models/useResponsiveLayout.js
git commit -m "feat(models): add responsive layout hook (split vs stacked)"
```

---

## Task 7: ModelCard component (all states except downloading)

Single card rendering Not-downloaded / Downloaded / selected states. Wires existing IPC handlers (`downloadMLModel`, `deleteLocalMLModel`, `getMLModelDownloadStatus`). Downloading state is folded in here too — splitting the file would just duplicate the polling logic. The species panel slot is rendered as a child for now (Task 8 fills it in).

**Files:**
- Create: `src/renderer/src/models/ModelCard.jsx`

- [ ] **Step 1: Implement ModelCard**

```jsx
// src/renderer/src/models/ModelCard.jsx
import { useState, useEffect, useCallback } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { findPythonEnvironment } from '../../../shared/mlmodels'
import {
  isOwnEnvironmentDownload,
  isDownloadComplete,
  determineInitialDownloadState,
  calculateProgressInfo
} from '../../../shared/downloadState'
import { getRegion, withAlpha } from './regions'

function formatSize(mb) {
  const rounded = Math.round(mb / 50) * 50
  return rounded > 1000 ? `${(rounded / 1000).toFixed(2)} GB` : `${rounded} MB`
}

export default function ModelCard({
  model,
  selected,
  speciesOpen,
  onSelect,
  onToggleSpecies,
  speciesPanel,
  refreshKey = 0,
  onDownloadStatusChange
}) {
  const region = getRegion(model.region)
  const pythonEnvironment = findPythonEnvironment(model.pythonEnvironment)

  const [status, setStatus] = useState({ model: {}, pythonEnvironment: {} })
  const [isDownloaded, setIsDownloaded] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  // Initial fetch + react to refreshKey (clear-all)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await window.api.getMLModelDownloadStatus({
        modelReference: model.reference,
        pythonEnvironmentReference: pythonEnvironment.reference
      })
      if (cancelled) return
      const init = determineInitialDownloadState({
        modelStatus: s.model,
        envStatus: s.pythonEnvironment,
        currentModelId: model.reference.id
      })
      setIsDownloaded(init.isDownloaded)
      setIsDownloading(init.isDownloading)
      setStatus(s)
    })()
    return () => {
      cancelled = true
    }
  }, [model.reference, pythonEnvironment.reference, refreshKey])

  // Polling while downloading
  useEffect(() => {
    if (!isDownloading) return undefined
    const id = setInterval(async () => {
      const s = await window.api.getMLModelDownloadStatus({
        modelReference: model.reference,
        pythonEnvironmentReference: pythonEnvironment.reference
      })
      setStatus(s)
      const envActiveModelId = s.pythonEnvironment?.opts?.activeDownloadModelId
      const isOwnEnvDl = isOwnEnvironmentDownload(envActiveModelId, model.reference.id)
      if (
        isDownloadComplete({
          modelState: s.model.state,
          envState: s.pythonEnvironment.state,
          isOwnEnvDownload: isOwnEnvDl
        })
      ) {
        setIsDownloaded(true)
        setIsDownloading(false)
      }
    }, 500)
    return () => clearInterval(id)
  }, [isDownloading, model.reference, pythonEnvironment.reference])

  // Notify parent when downloaded flips
  useEffect(() => {
    onDownloadStatusChange?.(model.reference.id, isDownloaded)
  }, [isDownloaded, model.reference.id, onDownloadStatusChange])

  const handleDownload = useCallback(async () => {
    setIsDownloading(true)
    try {
      await window.api.downloadMLModel(model.reference)
      await window.api.downloadPythonEnvironment({
        ...pythonEnvironment.reference,
        requestingModelId: model.reference.id
      })
      const s = await window.api.getMLModelDownloadStatus({
        modelReference: model.reference,
        pythonEnvironmentReference: pythonEnvironment.reference
      })
      setStatus(s)
      setIsDownloaded(true)
      setIsDownloading(false)
      toast.success(`${model.name} downloaded`, {
        description: 'The model is ready to use.',
        duration: 5000
      })
    } catch (err) {
      console.error('Download failed', err)
      setIsDownloading(false)
    }
  }, [model.reference, model.name, pythonEnvironment.reference])

  const handleDelete = useCallback(async () => {
    try {
      await window.api.deleteLocalMLModel(model.reference)
      setIsDownloaded(false)
    } catch (err) {
      console.error('Delete failed', err)
    }
  }, [model.reference])

  const { downloadMessage, downloadProgress } = calculateProgressInfo({
    modelStatus: status.model,
    envStatus: status.pythonEnvironment,
    currentModelId: model.reference.id
  })

  const borderColor = region?.color || '#6b7280'
  const cardClass = [
    'bg-white rounded-lg p-3 mb-2 border border-gray-200 cursor-pointer transition-shadow',
    selected ? 'shadow-[0_0_0_2px_rgba(0,0,0,0.06)] border-gray-900' : ''
  ].join(' ')

  return (
    <div
      className={cardClass}
      style={{ borderLeft: `4px solid ${borderColor}` }}
      onClick={() => onSelect?.(model.reference.id)}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-gray-900">{model.name}</span>
          {region && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ color: region.badgeText, background: region.badgeBg }}
            >
              {region.label}
            </span>
          )}
        </div>
        <StatusPill state={isDownloading ? 'downloading' : isDownloaded ? 'downloaded' : 'idle'} />
      </div>

      <div className="text-xs text-gray-500 mb-1">
        v{model.reference.version} · {formatSize(model.size_in_MB)} ·{' '}
        <strong>{model.species_count} species</strong>
      </div>

      {!isDownloading && <div className="text-xs text-gray-700 leading-snug">{model.description}</div>}

      {isDownloading ? (
        <div className="mt-2">
          <div className="bg-indigo-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-500">
            <span>{downloadMessage}</span>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          {isDownloaded ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDelete()
              }}
              className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 bg-white hover:bg-red-50"
            >
              <Trash2 size={12} className="inline mr-1" />
              Delete
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDownload()
              }}
              className="text-xs px-2 py-1 rounded bg-gray-900 text-white hover:bg-gray-800"
            >
              <Download size={12} className="inline mr-1" />
              Download
            </button>
          )}
        </div>
      )}

      <div
        className="mt-2 text-xs text-indigo-700 cursor-pointer select-none"
        onClick={(e) => {
          e.stopPropagation()
          onToggleSpecies?.(model.reference.id)
        }}
      >
        {speciesOpen ? '▾' : '▸'} {speciesOpen ? 'Hide' : 'View'} {model.species_count} species
      </div>

      {speciesOpen && speciesPanel}
    </div>
  )
}

function StatusPill({ state }) {
  if (state === 'downloaded') {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
        ✓ Downloaded
      </span>
    )
  }
  if (state === 'downloading') {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800">
        Downloading…
      </span>
    )
  }
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700">
      Not downloaded
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/models/ModelCard.jsx
git commit -m "feat(models): add ModelCard component with all download states"
```

---

## Task 8: SpeciesPanel component

Renders chips for small lists, search + class-summary for large. Uses Task 5's helpers.

**Files:**
- Create: `src/renderer/src/models/SpeciesPanel.jsx`

- [ ] **Step 1: Implement SpeciesPanel**

```jsx
// src/renderer/src/models/SpeciesPanel.jsx
import { useEffect, useMemo, useState } from 'react'
import { filterSpecies, classSummary } from './speciesPanelHelpers'

const SMALL_LIST_THRESHOLD = 50

const speciesCache = new Map()

async function loadSpecies(filename) {
  if (speciesCache.has(filename)) return speciesCache.get(filename)
  const mod = await import(`../../../shared/species/${filename}`)
  const data = mod.default
  speciesCache.set(filename, data)
  return data
}

export default function SpeciesPanel({ model }) {
  const [data, setData] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    loadSpecies(model.species_data).then((d) => {
      if (!cancelled) setData(d)
    })
    return () => {
      cancelled = true
    }
  }, [model.species_data])

  if (!data) {
    return (
      <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200 text-xs text-gray-500">
        Loading species…
      </div>
    )
  }

  const total = data.summary?.total ?? data.species.length
  const isLarge = total > SMALL_LIST_THRESHOLD

  return (
    <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        placeholder={isLarge ? 'Search any species…' : 'Filter species…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full px-2 py-1 text-xs border border-gray-300 rounded mb-2 bg-white"
      />
      {isLarge ? <LargeView data={data} query={query} /> : <SmallView data={data} query={query} />}
    </div>
  )
}

function SmallView({ data, query }) {
  const filtered = useMemo(() => filterSpecies(data.species, query), [data.species, query])
  if (filtered.length === 0) {
    return <div className="text-xs text-gray-500 italic">No matches.</div>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {filtered.map((s) => (
        <span
          key={s.scientific || s.common}
          className="text-[10px] bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-700"
          title={s.scientific}
        >
          {s.common}
        </span>
      ))}
    </div>
  )
}

function LargeView({ data, query }) {
  const summary = useMemo(() => classSummary(data), [data])
  const filtered = useMemo(() => filterSpecies(data.species || [], query), [data.species, query])

  if (query.trim()) {
    if (filtered.length === 0) {
      return <div className="text-xs text-gray-500 italic">No matches.</div>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {filtered.slice(0, 100).map((s) => (
          <span
            key={s.scientific || s.common}
            className="text-[10px] bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-700"
            title={s.scientific}
          >
            {s.common}
          </span>
        ))}
        {filtered.length > 100 && (
          <span className="text-[10px] text-gray-500 italic px-2 py-0.5">
            …and {filtered.length - 100} more
          </span>
        )}
      </div>
    )
  }

  if (!summary.classes) {
    return <div className="text-xs text-gray-500 italic">No taxonomic data available.</div>
  }

  return (
    <div className="flex flex-col gap-1">
      {summary.classes.map((c) => (
        <div key={c.id} className="flex justify-between items-center px-2 py-1 text-xs hover:bg-white rounded">
          <span>
            {c.icon} {c.label}
          </span>
          <span className="text-gray-500 text-[10px]">
            {c.approximate ? '~' : ''}
            {c.count}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/models/SpeciesPanel.jsx
git commit -m "feat(models): add SpeciesPanel with chip and grouped variants"
```

---

## Task 9: CustomModelCard component

Static card at the bottom of the list with the "We can train one for you" CTA.

**Files:**
- Create: `src/renderer/src/models/CustomModelCard.jsx`

- [ ] **Step 1: Implement CustomModelCard**

```jsx
// src/renderer/src/models/CustomModelCard.jsx
import { Mail } from 'lucide-react'
import { REGIONS } from './regions'

export default function CustomModelCard() {
  const region = REGIONS.custom
  return (
    <div
      className="bg-white rounded-lg p-3 mb-2 border border-gray-200 border-dashed mt-3"
      style={{ borderLeft: `4px dashed ${region.color}` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-bold text-sm text-gray-900">Custom model for your region</span>
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ color: region.badgeText, background: region.badgeBg }}
        >
          {region.label}
        </span>
      </div>
      <div className="text-xs text-gray-700 leading-snug mb-2">
        Don&apos;t see a model that fits your region or species? We can{' '}
        <strong>train one for you</strong>, or integrate a model you already have.
      </div>
      <a
        href="https://www.earthtoolsmaker.org/contact"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-900 text-white hover:bg-gray-800"
      >
        <Mail size={12} />
        Get in touch
      </a>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/models/CustomModelCard.jsx
git commit -m "feat(models): add CustomModelCard"
```

---

## Task 10: ModelListPane

Header (count + Clear All), ordered list of cards (SpeciesNet first, then alphabetical), CustomModelCard at the end. Threads selection, species-open, and refresh state down.

**Files:**
- Create: `src/renderer/src/models/ModelListPane.jsx`

- [ ] **Step 1: Implement ModelListPane**

```jsx
// src/renderer/src/models/ModelListPane.jsx
import { useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import ModelCard from './ModelCard'
import SpeciesPanel from './SpeciesPanel'
import CustomModelCard from './CustomModelCard'

function orderModels(modelZoo) {
  const worldwide = modelZoo.filter((m) => m.region === 'worldwide')
  const regional = modelZoo
    .filter((m) => m.region !== 'worldwide')
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...worldwide, ...regional]
}

export default function ModelListPane({
  modelZoo,
  selectedId,
  openSpeciesId,
  onSelect,
  onToggleSpecies,
  refreshKey,
  downloadedCount,
  onDownloadStatusChange,
  onClearAll
}) {
  const ordered = useMemo(() => orderModels(modelZoo), [modelZoo])

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-3 min-w-0">
      <div className="flex justify-between items-center mb-2 px-1">
        <span className="text-xs font-semibold text-gray-900">
          {modelZoo.length} models · {downloadedCount} downloaded
        </span>
        {downloadedCount > 0 && (
          <button
            onClick={onClearAll}
            className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
          >
            <Trash2 size={12} />
            Clear all
          </button>
        )}
      </div>

      {ordered.map((model) => (
        <ModelCard
          key={model.reference.id}
          model={model}
          selected={selectedId === model.reference.id}
          speciesOpen={openSpeciesId === model.reference.id}
          onSelect={onSelect}
          onToggleSpecies={onToggleSpecies}
          speciesPanel={<SpeciesPanel model={model} />}
          refreshKey={refreshKey}
          onDownloadStatusChange={onDownloadStatusChange}
        />
      ))}

      <CustomModelCard />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/models/ModelListPane.jsx
git commit -m "feat(models): add ModelListPane (ordered cards + custom row)"
```

---

## Task 11: MapPane (Leaflet + region overlays + worldwide chip)

Renders the Leaflet map with each model's region GeoJSON as a colored polygon. Worldwide is a chip floating above the map. Hovering / clicking a polygon syncs selection.

**Files:**
- Create: `src/renderer/src/models/MapPane.jsx`

- [ ] **Step 1: Implement MapPane**

```jsx
// src/renderer/src/models/MapPane.jsx
import { useEffect, useState, useMemo } from 'react'
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet'
import { getRegion, withAlpha } from './regions'

const geojsonCache = new Map()

async function loadRegionGeoJSON(filename) {
  if (geojsonCache.has(filename)) return geojsonCache.get(filename)
  const mod = await import(`../../../shared/regions/${filename}`)
  const data = mod.default
  geojsonCache.set(filename, data)
  return data
}

export default function MapPane({ modelZoo, selectedId, onSelect, layout }) {
  const worldwideModel = useMemo(
    () => modelZoo.find((m) => m.region === 'worldwide'),
    [modelZoo]
  )
  const regionalModels = useMemo(
    () => modelZoo.filter((m) => m.region !== 'worldwide' && getRegion(m.region)?.geojson),
    [modelZoo]
  )

  const [geojsonByModel, setGeojsonByModel] = useState({})

  useEffect(() => {
    let cancelled = false
    Promise.all(
      regionalModels.map(async (m) => {
        const region = getRegion(m.region)
        const data = await loadRegionGeoJSON(region.geojson)
        return [m.reference.id, data]
      })
    ).then((entries) => {
      if (!cancelled) setGeojsonByModel(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [regionalModels])

  const containerHeight = layout === 'stacked' ? '220px' : '100%'

  return (
    <div className="relative bg-blue-50 border-r border-gray-200" style={{ height: containerHeight }}>
      {worldwideModel && (
        <button
          onClick={() => onSelect?.(worldwideModel.reference.id)}
          className={[
            'absolute top-2 left-2 z-[500] text-xs font-semibold rounded-full px-3 py-1 shadow border-2 cursor-pointer',
            selectedId === worldwideModel.reference.id
              ? 'bg-indigo-500 text-white border-indigo-500'
              : 'bg-white/95 text-indigo-700 border-indigo-500 hover:bg-indigo-50'
          ].join(' ')}
        >
          🌍 Worldwide model available
        </button>
      )}

      <MapContainer
        center={[20, 20]}
        zoom={1}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        keyboard={false}
        attributionControl={false}
      >
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        {regionalModels.map((m) => {
          const region = getRegion(m.region)
          const data = geojsonByModel[m.reference.id]
          if (!data) return null
          const isSelected = selectedId === m.reference.id
          return (
            <GeoJSON
              key={m.reference.id}
              data={data}
              style={{
                color: region.color,
                weight: isSelected ? 3 : 2,
                fillColor: region.color,
                fillOpacity: isSelected ? 0.55 : 0.4
              }}
              eventHandlers={{
                click: () => onSelect?.(m.reference.id)
              }}
            />
          )
        })}
      </MapContainer>

      <div className="absolute bottom-2 left-2 z-[500] bg-white/90 rounded px-2 py-1 text-[10px] text-gray-700">
        Click a zone to see its model
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/models/MapPane.jsx
git commit -m "feat(models): add MapPane with region overlays and worldwide chip"
```

---

## Task 12: MlZoo top-level + responsive switching + replace in settings

Composes MapPane + ModelListPane, owns selection / species-open / refresh / downloaded-set state. Responsive layout switching between split (side-by-side) and stacked (map on top, list below).

**Files:**
- Create: `src/renderer/src/models/index.jsx`
- Modify: `src/renderer/src/settings.jsx:6-7`
- Modify: `src/renderer/src/settings.jsx:142`

- [ ] **Step 1: Implement MlZoo**

```jsx
// src/renderer/src/models/index.jsx
import { useState, useCallback } from 'react'
import MapPane from './MapPane'
import ModelListPane from './ModelListPane'
import { useResponsiveLayout } from './useResponsiveLayout'

export default function MlZoo({ modelZoo }) {
  const layout = useResponsiveLayout()
  const [selectedId, setSelectedId] = useState(
    () => modelZoo.find((m) => m.region === 'worldwide')?.reference.id ?? null
  )
  const [openSpeciesId, setOpenSpeciesId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [downloadedSet, setDownloadedSet] = useState(new Set())

  const handleSelect = useCallback((id) => setSelectedId(id), [])
  const handleToggleSpecies = useCallback(
    (id) => setOpenSpeciesId((cur) => (cur === id ? null : id)),
    []
  )
  const handleDownloadStatusChange = useCallback((modelId, isDownloaded) => {
    setDownloadedSet((prev) => {
      const next = new Set(prev)
      if (isDownloaded) next.add(modelId)
      else next.delete(modelId)
      return next
    })
  }, [])
  const handleClearAll = useCallback(async () => {
    try {
      const result = await window.api.clearAllLocalMLModel()
      if (result?.success) setRefreshKey((k) => k + 1)
    } catch (err) {
      console.error('Clear all failed', err)
    }
  }, [])

  const containerClass =
    layout === 'split'
      ? 'flex flex-row h-full max-w-7xl mx-auto'
      : 'flex flex-col h-full'

  const mapClass = layout === 'split' ? 'flex-1 min-w-0' : ''

  return (
    <div className={containerClass}>
      <div className={mapClass} style={layout === 'split' ? { flexBasis: '55%' } : {}}>
        <MapPane
          modelZoo={modelZoo}
          selectedId={selectedId}
          onSelect={handleSelect}
          layout={layout}
        />
      </div>
      <div className="flex-1 min-w-0" style={layout === 'split' ? { flexBasis: '45%' } : {}}>
        <ModelListPane
          modelZoo={modelZoo}
          selectedId={selectedId}
          openSpeciesId={openSpeciesId}
          onSelect={handleSelect}
          onToggleSpecies={handleToggleSpecies}
          refreshKey={refreshKey}
          downloadedCount={downloadedSet.size}
          onDownloadStatusChange={handleDownloadStatusChange}
          onClearAll={handleClearAll}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update the import in settings.jsx**

Edit `src/renderer/src/settings.jsx:6`:

Replace:
```js
import Zoo from './models'
```

With:
```js
import MlZoo from './models'
```

- [ ] **Step 3: Update the JSX in settings.jsx**

Edit `src/renderer/src/settings.jsx:142`:

Replace:
```jsx
<Zoo modelZoo={modelZoo} />
```

With:
```jsx
<MlZoo modelZoo={modelZoo} />
```

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev`

Open Settings → AI Models. Verify:
- Split view shows: map left (with Europe + Himalayas zones colored), list right.
- "🌍 Worldwide model available" chip is visible above the map.
- SpeciesNet card is first, marked as selected (the default).
- Each card has a colored left border matching its region.
- Clicking the Europe zone selects DeepFaune; clicking Himalayas selects Manas; clicking the Worldwide chip selects SpeciesNet.
- "View N species" expands a panel under the card. SpeciesNet shows the class summary; DeepFaune / Manas show chips.
- Resizing the window narrower than ~900 px stacks the layout (map on top, ~220 px tall).
- Download / Delete buttons trigger the same toasts and IPC behavior as before.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/models/index.jsx src/renderer/src/settings.jsx
git commit -m "feat(settings): wire new MlZoo into AI Models tab"
```

---

## Task 13: Delete the old `models.jsx`

Now that nothing imports `src/renderer/src/models.jsx`, remove it.

**Files:**
- Delete: `src/renderer/src/models.jsx`

- [ ] **Step 1: Confirm nothing else imports it**

Run: `grep -rn "from './models'" src/ | grep -v "src/renderer/src/models/"`
Expected: only matches under `src/renderer/src/models/` (the new directory's siblings importing each other), never the old flat file.

Run: `grep -rn "from '\./models\.jsx'" src/`
Expected: no matches.

- [ ] **Step 2: Delete the file**

```bash
git rm src/renderer/src/models.jsx
```

- [ ] **Step 3: Verify the app still builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(models): remove old monolithic models.jsx"
```

---

## Task 14: Update documentation

Per CLAUDE.md, code reorganization requires doc updates. The redesign affects renderer structure but no IPC; only `architecture.md` and `development.md` need touch-ups.

**Files:**
- Modify: `docs/architecture.md` (key files table or directory structure section)
- Modify: `docs/development.md` (project structure section)

- [ ] **Step 1: Inspect current docs to find the right sections**

Run:
```bash
grep -n "models.jsx\|Zoo\|AI Models\|src/renderer/src/models" docs/architecture.md docs/development.md
```

- [ ] **Step 2: Update each location**

For each match, change `src/renderer/src/models.jsx` references to `src/renderer/src/models/` (the directory). If a section enumerates the renderer's main files, add the new `models/` subdirectory containing `MapPane.jsx`, `ModelListPane.jsx`, `ModelCard.jsx`, `SpeciesPanel.jsx`, `CustomModelCard.jsx`, and `index.jsx`.

If `architecture.md` describes the AI Models tab, update its summary to mention the split-view layout and the `region` / `species_count` fields on `mlmodels.js` entries.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md docs/development.md
git commit -m "docs: update for AI Models tab split-view structure"
```

---

## Self-Review

**Spec coverage:**
- ✅ Split view, color-linked — Tasks 11, 12
- ✅ Worldwide as chip, not polygon — Task 11 (chip rendered above map)
- ✅ SpeciesNet first in the list — Task 10 (`orderModels` puts worldwide first)
- ✅ Card states (Not / Downloading / Downloaded / Custom) — Tasks 7, 9
- ✅ Inline progress + cancel during download — Task 7 (progress bar; "Cancel" not yet wired — see open question below)
- ✅ Description hidden during download — Task 7 (`{!isDownloading && ...}`)
- ✅ Species panel: chips for ≤50, search + groups for >50 — Tasks 5, 8
- ✅ Custom row at bottom, dashed border, "Get in touch" CTA — Task 9
- ✅ Region + species_count in mlmodels.js — Task 2
- ✅ GeoJSON / species static files — Tasks 3, 4
- ✅ No IPC changes — Tasks 7, 12 reuse all existing `window.api.*`
- ✅ Component decomposition matches spec — Tasks 6–11
- ✅ Responsive (≥900 split, <900 stacked, ~220 px map) — Tasks 6, 11, 12
- ✅ Single open species panel at a time — Task 12 (`openSpeciesId` is a single value)
- ✅ Clear All preserved — Task 12

**Spec items deferred (intentionally):**
- ⏭ Real Natural Earth GeoJSON — Task 4 ships placeholders; README documents the swap.
- ⏭ Full SpeciesNet 2,000-species list — Task 3 ships the structured summary; the panel works either way.
- ⏭ Cancel-download button wiring — the spec mentions "Cancel" but today's IPC has no cancel handler. The button placeholder exists in the design; wiring is a follow-up requiring backend work, out of scope for this plan.
- ⏭ Map zone pulse during download — flagged as "optional polish" in the spec.
- ⏭ Scaling affordances (region grouping headers, compact rows, list search) — explicitly deferred in the spec until N grows.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" left. Two notes flag upstream data confirmation (DeepFaune count, Manas count) — these are explicit Open Questions in the spec, not silent placeholders.

**Type / name consistency:**
- `selectedId` used consistently in MlZoo, MapPane, ModelListPane, ModelCard.
- `openSpeciesId` used consistently.
- `onSelect`, `onToggleSpecies`, `onDownloadStatusChange`, `onClearAll` callbacks named consistently across parent → child.
- `getRegion`, `withAlpha`, `REGIONS` from `regions.js` referenced with the same names everywhere.
- `species_data` (JSON filename) and `species_count` field names match across `mlmodels.js`, `ModelCard.jsx`, `SpeciesPanel.jsx`.

---

**Plan complete and saved to `docs/plans/2026-05-05-ai-models-tab-plan.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — I execute tasks here using executing-plans, batching with checkpoints.

Which approach?
