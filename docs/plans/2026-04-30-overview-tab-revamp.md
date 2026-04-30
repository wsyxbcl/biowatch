# Overview Tab Revamp — Editorial Showcase Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Overview tab into a single editorial showcase layout with five always-rendered sections (title, editorial header with map, KPI band, best captures, species distribution). Same shell every study, polite empty states, contributor cards moved into a modal. Per spec at `docs/specs/2026-04-30-overview-tab-revamp-design.md`.

**Architecture:** Twelve incremental tasks. The first two land the backend (a new `getOverviewStats` query + IPC) so renderer work can call real data. Tasks 3-9 build the new components bottom-up (each component lives in its own file under `src/renderer/src/overview/`), each one TDD'd or manually verifiable in isolation. Task 10 wires everything into a slimmed-down `overview.jsx`. Task 11 is end-to-end manual verification across study states; Task 12 updates docs per CLAUDE.md.

**Tech Stack:** Electron + React 18 + Tailwind + lucide-react in the renderer (`src/renderer/src/`); Drizzle ORM + better-sqlite3 in main (`src/main/database/`); `@tanstack/react-query` for data; `node:test` + `node:assert/strict` for unit tests; Electron-Vite for the dev server.

**Starting branch:** `arthur/ui-overview-tab-revamp` (already contains the spec commit).

---

## File map

| File | Change |
|---|---|
| `src/main/database/queries/overview.js` | **Create** — `getOverviewStats(dbPath)` returns the consolidated stats payload (counts, derived range, threatened count, camera-days). |
| `src/main/database/queries/index.js` | **Modify** — re-export `getOverviewStats`. |
| `test/main/database/queries/overviewStats.test.js` | **Create** — TDD tests for `getOverviewStats` covering happy-path + empty study + missing-deployment-dates. |
| `src/main/ipc/overview.js` | **Create** — `registerOverviewIPCHandlers()` exporting one channel `overview:get-stats`. |
| `src/main/ipc/index.js` | **Modify** — register `registerOverviewIPCHandlers()`. |
| `src/preload/index.js` | **Modify** — add `getOverviewStats(studyId)`. |
| `src/renderer/src/overview/utils/formatStats.js` | **Create** — three pure formatters: `formatStatNumber`, `formatSpan`, `formatRangeShort`. |
| `test/renderer/overview/formatStats.test.js` | **Create** — unit tests for each formatter. |
| `src/renderer/src/overview/KpiTile.jsx` | **Create** — pure presentational tile (icon + label + number + optional sub-detail + optional onEdit). |
| `src/renderer/src/overview/KpiBand.jsx` | **Create** — composes 5 `KpiTile`s from a stats payload. Span tile owns the `DateTimePicker` popover. |
| `src/renderer/src/overview/ContributorByline.jsx` | **Create** — compact "By A · B · C +N more · ✎ Manage" line. |
| `src/renderer/src/overview/ContributorsModal.jsx` | **Create** — modal owning the contributors CRUD state (extracted from current overview.jsx). |
| `src/renderer/src/ui/BestMediaCarousel.jsx` | **Modify** — accept new `renderEmpty` prop. Default behavior unchanged. |
| `src/renderer/src/overview/BestCapturesSection.jsx` | **Create** — section header + `BestMediaCarousel` + dashed empty-state placeholder. |
| `src/renderer/src/overview/SpeciesDistribution.jsx` | **Create** — moved from `overview.jsx`, restyled for full-width with empty state. |
| `src/renderer/src/ui/DateTimePicker.jsx` | **Modify** — accept optional `onResetToAuto` prop; render a "Reset to auto" link when provided. |
| `src/renderer/src/overview/EditorialHeader.jsx` | **Create** — title + description + byline (left column) and `DeploymentMap` (right column). |
| `src/renderer/src/overview.jsx` | **Modify** — strip out everything that moved into `overview/*`. Compose `EditorialHeader`, `KpiBand`, `BestCapturesSection`, `SpeciesDistribution`. Keep `DeploymentMap` here for now (used inside EditorialHeader). |
| `docs/architecture.md` | **Modify** — note the new `overview/` directory + `getOverviewStats` IPC in relevant sections. |
| `docs/ipc-api.md` | **Modify** — document the new IPC channel. |
| `docs/database-schema.md` | **Modify** — note the `metadata.startDate / endDate` override semantics. |

The `DeploymentMap` component continues to live in `overview.jsx` for now — moving it out is a separate concern. `EditorialHeader` accepts it as a child to keep the dependency clean.

---

## Task 1: Add `getOverviewStats` query module (TDD)

**Files:**
- Create: `src/main/database/queries/overview.js`
- Test: `test/main/database/queries/overviewStats.test.js`

The query returns a single payload with all the numbers + derived date range the new KPI band needs. It joins the species set against `speciesInfo` server-side so the renderer doesn't need to ship the dictionary just to count threatened species.

Reference shape (matches spec):

```js
{
  speciesCount: number,
  threatenedCount: number,
  cameraCount: number,
  locationCount: number,
  observationCount: number,
  cameraDays: number,                  // SUM(julianday(end) - julianday(start))
  mediaCount: number,
  derivedRange: {
    start: string | null,              // ISO date 'YYYY-MM-DD' or null
    end: string | null
  }
}
```

Derivation chain for `derivedRange`, evaluated **independently per side**:
1. `metadata.startDate` / `metadata.endDate` (override)
2. `min/max(observations.eventStart)`
3. `min/max(deployments.deploymentStart)` for start, `max(deployments.deploymentEnd)` for end
4. `min/max(media.timestamp)`
5. `null` if all sources empty

Threatened: a species is threatened iff `speciesInfo[name].iucn ∈ {VU, EN, CR, EW, EX}`. Implement using `resolveSpeciesInfo` from `src/shared/speciesInfo/resolver.js`.

### Steps

- [ ] **Step 1: Write the failing tests**

Create `test/main/database/queries/overviewStats.test.js`:

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getOverviewStats,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    // electron-log not available, that's fine
  }

  testStudyId = `test-overviewstats-${Date.now()}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-overviewstats-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

describe('getOverviewStats', () => {
  test('empty study: all zeros, derivedRange both null', async () => {
    await createImageDirectoryDatabase(testDbPath)

    const stats = await getOverviewStats(testDbPath)

    assert.equal(stats.speciesCount, 0)
    assert.equal(stats.threatenedCount, 0)
    assert.equal(stats.cameraCount, 0)
    assert.equal(stats.locationCount, 0)
    assert.equal(stats.observationCount, 0)
    assert.equal(stats.cameraDays, 0)
    assert.equal(stats.mediaCount, 0)
    assert.equal(stats.derivedRange.start, null)
    assert.equal(stats.derivedRange.end, null)
  })

  test('study with deployments only: ranges fall back to deployment dates', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'Site A',
        deploymentStart: DateTime.fromISO('2023-03-15T10:00:00Z'),
        deploymentEnd: DateTime.fromISO('2023-06-15T18:00:00Z'),
        latitude: 46.7,
        longitude: 6.6,
        cameraID: 'cam1'
      },
      d2: {
        deploymentID: 'd2',
        locationID: 'loc2',
        locationName: 'Site B',
        deploymentStart: DateTime.fromISO('2023-04-01T09:00:00Z'),
        deploymentEnd: DateTime.fromISO('2023-08-01T19:00:00Z'),
        latitude: 46.8,
        longitude: 6.7,
        cameraID: 'cam2'
      }
    })

    const stats = await getOverviewStats(testDbPath)

    assert.equal(stats.cameraCount, 2)
    assert.equal(stats.locationCount, 2)
    assert.equal(stats.observationCount, 0)
    // derivedRange falls back to deployments
    assert.equal(stats.derivedRange.start, '2023-03-15')
    assert.equal(stats.derivedRange.end, '2023-08-01')
    // ~92 days + ~122 days = ~214 days. Allow ±2 for julianday math.
    assert.ok(
      stats.cameraDays >= 212 && stats.cameraDays <= 216,
      `cameraDays out of range: ${stats.cameraDays}`
    )
  })

  test('observations override deployment range; threatened count tallies VU/EN/CR', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'Site A',
        deploymentStart: DateTime.fromISO('2023-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2023-12-31T23:59:59Z'),
        latitude: 46.7,
        longitude: 6.6,
        cameraID: 'cam1'
      }
    })
    await insertMedia(manager, [
      {
        mediaID: 'm1',
        deploymentID: 'd1',
        timestamp: '2023-04-15T10:00:00Z',
        filePath: '/a.jpg',
        fileName: 'a.jpg'
      },
      {
        mediaID: 'm2',
        deploymentID: 'd1',
        timestamp: '2023-09-20T12:00:00Z',
        filePath: '/b.jpg',
        fileName: 'b.jpg'
      }
    ])
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm1',
        deploymentID: 'd1',
        eventStart: '2023-04-15T10:00:00Z',
        scientificName: 'Vulpes vulpes',  // LC
        observationType: 'animal',
        count: 1
      },
      {
        observationID: 'o2',
        mediaID: 'm2',
        deploymentID: 'd1',
        eventStart: '2023-09-20T12:00:00Z',
        scientificName: 'Ursus arctos',   // VU — counts as threatened
        observationType: 'animal',
        count: 1
      }
    ])

    const stats = await getOverviewStats(testDbPath)

    assert.equal(stats.speciesCount, 2)
    assert.equal(stats.threatenedCount, 1)
    assert.equal(stats.observationCount, 2)
    assert.equal(stats.mediaCount, 2)
    // observations override deployments for derivedRange
    assert.equal(stats.derivedRange.start, '2023-04-15')
    assert.equal(stats.derivedRange.end, '2023-09-20')
  })

  test('metadata.startDate/endDate override observations and deployments', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    // Set the override directly
    const sqlite = manager.getSqlite()
    sqlite
      .prepare('INSERT OR REPLACE INTO metadata (id, name, created, importerName, startDate, endDate) VALUES (?, ?, ?, ?, ?, ?)')
      .run(testStudyId, 'Test', new Date().toISOString(), 'test', '2020-01-01', '2024-12-31')
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'Site A',
        deploymentStart: DateTime.fromISO('2023-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2023-12-31T00:00:00Z'),
        latitude: 46.7,
        longitude: 6.6,
        cameraID: 'cam1'
      }
    })

    const stats = await getOverviewStats(testDbPath)
    assert.equal(stats.derivedRange.start, '2020-01-01')
    assert.equal(stats.derivedRange.end, '2024-12-31')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:rebuild
node --test test/main/database/queries/overviewStats.test.js
```

Expected: failure on import — `Cannot find module '.../overviewStats'` or `getOverviewStats is not a function`.

- [ ] **Step 3: Create the query module**

Create `src/main/database/queries/overview.js`:

```js
/**
 * Overview tab — consolidated stats query.
 * Returns one payload covering every KPI tile shown on the Overview tab,
 * including the derived date range used by the Span tile.
 */

import {
  getDrizzleDb,
  getStudyDatabase,
  deployments,
  media,
  observations
} from '../index.js'
import { eq, and, isNotNull, ne, sql, count, countDistinct } from 'drizzle-orm'
import log from 'electron-log'
import { getStudyIdFromPath } from './utils.js'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/resolver.js'

const THREATENED_IUCN = new Set(['VU', 'EN', 'CR', 'EW', 'EX'])

/**
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<{
 *   speciesCount: number,
 *   threatenedCount: number,
 *   cameraCount: number,
 *   locationCount: number,
 *   observationCount: number,
 *   cameraDays: number,
 *   mediaCount: number,
 *   derivedRange: { start: string | null, end: string | null }
 * }>}
 */
export async function getOverviewStats(dbPath) {
  const startTime = Date.now()
  log.info(`Querying overview stats from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })
    const manager = await getStudyDatabase(studyId, dbPath, { readonly: true })
    const sqlite = manager.getSqlite()

    // 1. Distinct species set (excluding blanks/nulls/empty strings)
    const speciesRows = await db
      .select({ scientificName: observations.scientificName })
      .from(observations)
      .where(
        and(
          isNotNull(observations.scientificName),
          ne(observations.scientificName, ''),
          sql`(${observations.observationType} IS NULL OR ${observations.observationType} != 'blank')`
        )
      )
      .groupBy(observations.scientificName)

    const speciesCount = speciesRows.length
    const threatenedCount = speciesRows.reduce((acc, row) => {
      const info = resolveSpeciesInfo(row.scientificName)
      return acc + (info?.iucn && THREATENED_IUCN.has(info.iucn) ? 1 : 0)
    }, 0)

    // 2. Camera + location counts (single query each via countDistinct)
    const camerasResult = await db
      .select({ n: countDistinct(deployments.cameraID).as('n') })
      .from(deployments)
      .where(isNotNull(deployments.cameraID))
      .get()
    const cameraCount = camerasResult?.n ?? 0

    const locationsResult = await db
      .select({ n: countDistinct(deployments.locationID).as('n') })
      .from(deployments)
      .where(isNotNull(deployments.locationID))
      .get()
    const locationCount = locationsResult?.n ?? 0

    // 3. Observation count (excluding blanks)
    const obsResult = await db
      .select({ n: count().as('n') })
      .from(observations)
      .where(
        sql`(${observations.observationType} IS NULL OR ${observations.observationType} != 'blank')`
      )
      .get()
    const observationCount = obsResult?.n ?? 0

    // 4. Camera-days: SUM(julianday(end) - julianday(start)) over deployments
    //    that have both fields set. Round to nearest integer day.
    const cameraDaysRow = sqlite
      .prepare(
        `SELECT COALESCE(
           SUM(julianday(deploymentEnd) - julianday(deploymentStart)),
           0
         ) AS days
         FROM deployments
         WHERE deploymentStart IS NOT NULL
           AND deploymentEnd IS NOT NULL
           AND julianday(deploymentEnd) IS NOT NULL
           AND julianday(deploymentStart) IS NOT NULL`
      )
      .get()
    const cameraDays = Math.round(cameraDaysRow?.days || 0)

    // 5. Media count
    const mediaResult = await db
      .select({ n: count().as('n') })
      .from(media)
      .get()
    const mediaCount = mediaResult?.n ?? 0

    // 6. Derived range
    const derivedRange = await deriveRange(sqlite)

    const elapsedTime = Date.now() - startTime
    log.info(
      `Overview stats: ${speciesCount} species, ${observationCount} obs, ${mediaCount} media in ${elapsedTime}ms`
    )

    return {
      speciesCount,
      threatenedCount,
      cameraCount,
      locationCount,
      observationCount,
      cameraDays,
      mediaCount,
      derivedRange
    }
  } catch (error) {
    log.error(`Error in getOverviewStats: ${error.message}`)
    throw error
  }
}

/**
 * Resolve start and end independently using the override → observations →
 * deployments → media chain. Returns ISO date strings (YYYY-MM-DD) or null.
 */
async function deriveRange(sqlite) {
  // Override (metadata.startDate / endDate). The metadata row may not exist
  // for very fresh studies; tolerate undefined.
  const meta = sqlite
    .prepare('SELECT startDate, endDate FROM metadata LIMIT 1')
    .get()
  const overrideStart = meta?.startDate || null
  const overrideEnd = meta?.endDate || null

  // Observations
  const obs = sqlite
    .prepare(
      `SELECT MIN(eventStart) AS minE, MAX(eventStart) AS maxE
         FROM observations
         WHERE eventStart IS NOT NULL AND eventStart != ''`
    )
    .get()

  // Deployments — start uses deploymentStart, end uses deploymentEnd
  const dep = sqlite
    .prepare(
      `SELECT MIN(deploymentStart) AS minS, MAX(deploymentEnd) AS maxE
         FROM deployments
         WHERE deploymentStart IS NOT NULL AND deploymentStart != ''
            OR deploymentEnd IS NOT NULL AND deploymentEnd != ''`
    )
    .get()

  // Media timestamps
  const med = sqlite
    .prepare(
      `SELECT MIN(timestamp) AS minT, MAX(timestamp) AS maxT
         FROM media
         WHERE timestamp IS NOT NULL AND timestamp != ''`
    )
    .get()

  const startSources = [
    overrideStart,
    obs?.minE,
    dep?.minS,
    med?.minT
  ]
  const endSources = [
    overrideEnd,
    obs?.maxE,
    dep?.maxE,
    med?.maxT
  ]

  return {
    start: toIsoDate(startSources.find((v) => !!v)),
    end: toIsoDate(endSources.find((v) => !!v))
  }
}

function toIsoDate(value) {
  if (!value) return null
  // value can be 'YYYY-MM-DD' or full ISO 'YYYY-MM-DDTHH:MM:SSZ'.
  // Take the first 10 characters either way.
  return String(value).slice(0, 10)
}
```

- [ ] **Step 4: Re-export from queries index**

In `src/main/database/queries/index.js`, add the new export. After the existing "// Best media selection" block (around line 60), add:

```js
// Overview stats
export { getOverviewStats } from './overview.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node --test test/main/database/queries/overviewStats.test.js
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Run the full test suite to confirm nothing else broke**

```bash
npm test
```

Expected: all tests pass. (`npm test` does the rebuild for native modules — slow but necessary on a clean checkout.)

- [ ] **Step 7: Commit**

```bash
git add src/main/database/queries/overview.js src/main/database/queries/index.js test/main/database/queries/overviewStats.test.js
git commit -m "feat(overview): add getOverviewStats query for KPI band"
```

---

## Task 2: Wire `overview:get-stats` IPC handler + preload

**Files:**
- Create: `src/main/ipc/overview.js`
- Modify: `src/main/ipc/index.js`
- Modify: `src/preload/index.js`

### Steps

- [ ] **Step 1: Create the IPC handler module**

Create `src/main/ipc/overview.js`:

```js
/**
 * Overview tab — IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import { getOverviewStats } from '../database/index.js'

export function registerOverviewIPCHandlers() {
  ipcMain.handle('overview:get-stats', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }
      const stats = await getOverviewStats(dbPath)
      return { data: stats }
    } catch (error) {
      log.error('Error getting overview stats:', error)
      return { error: error.message }
    }
  })
}
```

- [ ] **Step 2: Register the new handler**

In `src/main/ipc/index.js`, add the import (alphabetically near the others) and the registration call.

After `import { registerInfoIPCHandlers } from './info.js'`, add:
```js
import { registerOverviewIPCHandlers } from './overview.js'
```

Inside `registerAllIPCHandlers()`, after `registerInfoIPCHandlers()`, add:
```js
  registerOverviewIPCHandlers()
```

In the re-export block at the bottom, add `registerOverviewIPCHandlers` to the list.

- [ ] **Step 3: Add preload bridge**

In `src/preload/index.js`, after `getBestImagePerSpecies` (around line 81-83), add:

```js
  getOverviewStats: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('overview:get-stats', studyId)
  },
```

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```

Open the app, open any study. In DevTools console:
```js
await window.api.getOverviewStats('YOUR_STUDY_ID')
```

Expected: returns `{ data: { speciesCount, threatenedCount, ... } }` with realistic numbers.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/overview.js src/main/ipc/index.js src/preload/index.js
git commit -m "feat(overview): wire overview:get-stats IPC and preload"
```

---

## Task 3: Renderer formatters (TDD)

**Files:**
- Create: `src/renderer/src/overview/utils/formatStats.js`
- Test: `test/renderer/overview/formatStats.test.js`

Three pure formatters used by the KPI band:

- `formatStatNumber(n)` — `1234` → `"1,234"`, `12453` → `"12.5K"`, `1234567` → `"1.2M"`. Returns `"—"` for null/undefined/`NaN`.
- `formatSpan(startIso, endIso)` — given two ISO date strings, returns `"4 yr"`, `"3 mo"`, etc. Returns `"—"` if either side is null.
- `formatRangeShort(startIso, endIso)` — `"Jan '20 – Dec '24"`. Returns `null` if either side is null (caller omits the sub-detail).

### Steps

- [ ] **Step 1: Write the failing tests**

Create `test/renderer/overview/formatStats.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatStatNumber,
  formatSpan,
  formatRangeShort
} from '../../../src/renderer/src/overview/utils/formatStats.js'

describe('formatStatNumber', () => {
  test('returns em-dash for null / undefined / NaN', () => {
    assert.equal(formatStatNumber(null), '—')
    assert.equal(formatStatNumber(undefined), '—')
    assert.equal(formatStatNumber(NaN), '—')
  })

  test('preserves small numbers with locale separators', () => {
    assert.equal(formatStatNumber(0), '0')
    assert.equal(formatStatNumber(47), '47')
    assert.equal(formatStatNumber(999), '999')
    assert.equal(formatStatNumber(1234), '1,234')
    assert.equal(formatStatNumber(9999), '9,999')
  })

  test('compacts to K above 9,999', () => {
    assert.equal(formatStatNumber(10000), '10K')
    assert.equal(formatStatNumber(12453), '12.5K')
    assert.equal(formatStatNumber(999999), '1M')
  })

  test('compacts to M above 999,999', () => {
    assert.equal(formatStatNumber(1234567), '1.2M')
    assert.equal(formatStatNumber(12_345_678), '12.3M')
  })
})

describe('formatSpan', () => {
  test('returns em-dash for null/missing inputs', () => {
    assert.equal(formatSpan(null, '2024-01-01'), '—')
    assert.equal(formatSpan('2024-01-01', null), '—')
    assert.equal(formatSpan(null, null), '—')
  })

  test('full year span returns "<N> yr"', () => {
    assert.equal(formatSpan('2020-01-01', '2024-12-31'), '5 yr')
    assert.equal(formatSpan('2023-04-01', '2024-04-01'), '1 yr')
  })

  test('sub-year spans return "<N> mo"', () => {
    assert.equal(formatSpan('2024-01-01', '2024-04-01'), '3 mo')
    assert.equal(formatSpan('2024-06-01', '2024-12-15'), '6 mo')
  })

  test('zero-length range', () => {
    assert.equal(formatSpan('2024-01-01', '2024-01-01'), '0 mo')
  })
})

describe('formatRangeShort', () => {
  test('returns null for missing inputs', () => {
    assert.equal(formatRangeShort(null, '2024-01-01'), null)
    assert.equal(formatRangeShort('2024-01-01', null), null)
  })

  test('formats as "MMM \'YY – MMM \'YY"', () => {
    // Use a regex to allow the U+2013 EN DASH (–) the formatter emits
    const result = formatRangeShort('2020-01-15', '2024-12-15')
    assert.match(result, /^Jan '20\s–\sDec '24$/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test test/renderer/overview/formatStats.test.js
```

Expected: failure on import — module not found.

- [ ] **Step 3: Create the formatter module**

Create `src/renderer/src/overview/utils/formatStats.js`:

```js
/**
 * KPI band formatters. Pure, no React/DOM deps.
 */

const EM_DASH = '—'
const EN_DASH = '–'

/**
 * Format a count for a KPI tile.
 *  - null/undefined/NaN → "—"
 *  - 0..9999 → locale-formatted integer (e.g. "1,234")
 *  - 10K..999K → "12.5K" (one decimal, dropped if .0)
 *  - 1M+ → "1.2M"
 */
export function formatStatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return EM_DASH
  if (n < 10_000) return n.toLocaleString('en-US')
  if (n < 1_000_000) return compact(n / 1000) + 'K'
  return compact(n / 1_000_000) + 'M'
}

function compact(value) {
  // 1 decimal, drop trailing ".0" (e.g. 10.0 → "10", 12.5 → "12.5").
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/**
 * Format a date span as "<N> yr" if ≥ 12 months, else "<N> mo".
 * Both inputs are ISO date strings (YYYY-MM-DD or full ISO 8601).
 * Returns "—" if either is null/empty.
 */
export function formatSpan(startIso, endIso) {
  if (!startIso || !endIso) return EM_DASH
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return EM_DASH

  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth())
  if (months >= 12) {
    const years = Math.round(months / 12)
    return `${years} yr`
  }
  return `${Math.max(0, months)} mo`
}

/**
 * Format a date range as "MMM 'YY – MMM 'YY" (en-US).
 * Returns null if either side is null — caller omits the sub-detail.
 */
export function formatRangeShort(startIso, endIso) {
  if (!startIso || !endIso) return null
  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: '2-digit'
  })
  const startStr = fmt.format(new Date(startIso)).replace(' ', " '")
  const endStr = fmt.format(new Date(endIso)).replace(' ', " '")
  return `${startStr} ${EN_DASH} ${endStr}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test test/renderer/overview/formatStats.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/overview/utils/formatStats.js test/renderer/overview/formatStats.test.js
git commit -m "feat(overview): add KPI formatters (formatStatNumber, formatSpan, formatRangeShort)"
```

---

## Task 4: KpiTile + KpiBand components

**Files:**
- Create: `src/renderer/src/overview/KpiTile.jsx`
- Create: `src/renderer/src/overview/KpiBand.jsx`

`KpiTile` is a pure presentational component. `KpiBand` is the data-aware composition that fetches stats via `useQuery` and renders 5 tiles. The Span tile owns its own `DateTimePicker` popover — this is intentional so the editorial-header hover group stays isolated from the KPI band's hover behavior (per spec).

### Steps

- [ ] **Step 1: Create `KpiTile.jsx`**

Create `src/renderer/src/overview/KpiTile.jsx`:

```jsx
import { Pencil } from 'lucide-react'

/**
 * One KPI tile — icon + label + number + optional sub-detail.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.icon - Lucide icon element (already sized 14x14).
 * @param {string} props.label - Uppercase label text.
 * @param {string} props.value - Pre-formatted number (or "—").
 * @param {string} [props.sub] - Sub-detail line (omitted if falsy).
 * @param {React.ReactNode} [props.subAccent] - Pre-formatted accent fragment for the sub line (e.g., the "8" in "8 threatened"). Optional.
 * @param {() => void} [props.onEdit] - When provided, the tile is editable: shows a pencil on hover and clicking the tile (or pencil) calls onEdit.
 */
export default function KpiTile({ icon, label, value, sub, subAccent, onEdit }) {
  const editable = typeof onEdit === 'function'
  const Tag = editable ? 'button' : 'div'

  return (
    <Tag
      type={editable ? 'button' : undefined}
      onClick={editable ? onEdit : undefined}
      className={`group relative bg-white border border-gray-200 rounded-lg px-3.5 py-3.5 text-left transition-colors hover:border-blue-300 hover:bg-slate-50 ${
        editable ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300' : ''
      }`}
    >
      {editable && (
        <Pencil
          size={11}
          className="absolute top-2 right-2 text-gray-400 opacity-0 group-hover:opacity-60 transition-opacity"
          aria-hidden="true"
        />
      )}

      <div className="flex items-center gap-1.5 mb-1.5 text-blue-600">
        {icon}
        <span className="text-[0.65rem] font-semibold tracking-wide text-gray-500 uppercase">
          {label}
        </span>
      </div>

      <div className="text-2xl font-bold text-gray-900 tabular-nums leading-none">
        {value}
      </div>

      {sub && (
        <div className="mt-1.5 text-[0.7rem] text-gray-500">
          {subAccent && <span className="text-blue-700 font-semibold">{subAccent}</span>}
          {subAccent && ' '}
          {sub}
        </div>
      )}
    </Tag>
  )
}
```

- [ ] **Step 2: Create `KpiBand.jsx`**

Create `src/renderer/src/overview/KpiBand.jsx`:

```jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PawPrint, Camera, CalendarDays, Eye, Image as ImageIcon } from 'lucide-react'
import KpiTile from './KpiTile'
import DateTimePicker from '../ui/DateTimePicker'
import {
  formatStatNumber,
  formatSpan,
  formatRangeShort
} from './utils/formatStats'

const ICON_SIZE = 14

/**
 * KPI band for the Overview tab. Five tiles: Species, Cameras, Span, Observations, Media.
 * The Span tile is editable; clicking opens the DateTimePicker popover.
 *
 * @param {Object} props
 * @param {string} props.studyId
 * @param {Object} props.studyData - The full study data object (for read of metadata.startDate/endDate during edit).
 * @param {boolean} props.isImporting - Whether an import is in progress; controls polling.
 */
export default function KpiBand({ studyId, studyData, isImporting }) {
  const queryClient = useQueryClient()
  const [showStartPicker, setShowStartPicker] = useState(false)
  const [showEndPicker, setShowEndPicker] = useState(false)

  const { data: stats } = useQuery({
    queryKey: ['overviewStats', studyId],
    queryFn: async () => {
      const response = await window.api.getOverviewStats(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    refetchInterval: isImporting ? 5000 : false,
    placeholderData: (prev) => prev
  })

  const speciesCount = stats?.speciesCount ?? null
  const threatenedCount = stats?.threatenedCount ?? null
  const cameraCount = stats?.cameraCount ?? null
  const locationCount = stats?.locationCount ?? null
  const observationCount = stats?.observationCount ?? null
  const cameraDays = stats?.cameraDays ?? null
  const mediaCount = stats?.mediaCount ?? null
  const rangeStart = stats?.derivedRange?.start ?? null
  const rangeEnd = stats?.derivedRange?.end ?? null

  const saveDate = async (which, isoTimestamp) => {
    const dateOnly = isoTimestamp.split('T')[0]
    const newTemporal = { ...(studyData?.temporal || {}) }
    newTemporal[which] = dateOnly
    await window.api.updateStudy(studyId, {
      data: { ...studyData, temporal: newTemporal }
    })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    queryClient.invalidateQueries({ queryKey: ['overviewStats', studyId] })
    setShowStartPicker(false)
    setShowEndPicker(false)
  }

  const resetDatesToAuto = async () => {
    const newTemporal = { ...(studyData?.temporal || {}) }
    delete newTemporal.start
    delete newTemporal.end
    await window.api.updateStudy(studyId, {
      data: { ...studyData, temporal: newTemporal }
    })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    queryClient.invalidateQueries({ queryKey: ['overviewStats', studyId] })
    setShowStartPicker(false)
    setShowEndPicker(false)
  }

  return (
    <div className="grid grid-cols-5 gap-2.5">
      <KpiTile
        icon={<PawPrint size={ICON_SIZE} />}
        label="Species"
        value={formatStatNumber(speciesCount)}
        sub={threatenedCount > 0 ? 'threatened' : null}
        subAccent={threatenedCount > 0 ? formatStatNumber(threatenedCount) : null}
      />
      <KpiTile
        icon={<Camera size={ICON_SIZE} />}
        label="Cameras"
        value={formatStatNumber(cameraCount)}
        sub={locationCount > 0 ? `across ${formatStatNumber(locationCount)} locations` : null}
      />

      <div className="relative">
        <KpiTile
          icon={<CalendarDays size={ICON_SIZE} />}
          label="Span"
          value={formatSpan(rangeStart, rangeEnd)}
          sub={formatRangeShort(rangeStart, rangeEnd)}
          onEdit={() => setShowStartPicker(true)}
        />
        {showStartPicker && (
          <div className="absolute left-0 top-full mt-2 z-50">
            <DateTimePicker
              value={rangeStart ? `${rangeStart}T00:00:00` : new Date().toISOString()}
              onChange={(iso) => saveDate('start', iso)}
              onCancel={() => setShowStartPicker(false)}
              onResetToAuto={resetDatesToAuto}
              dateOnly
            />
          </div>
        )}
      </div>

      <KpiTile
        icon={<Eye size={ICON_SIZE} />}
        label="Observations"
        value={formatStatNumber(observationCount)}
        sub={cameraDays > 0 ? `from ${formatStatNumber(cameraDays)} camera-days` : null}
      />
      <KpiTile
        icon={<ImageIcon size={ICON_SIZE} />}
        label="Media"
        value={formatStatNumber(mediaCount)}
        sub={mediaCount > 0 ? 'photos & videos' : null}
      />
    </div>
  )
}
```

Note: the Span tile uses **one** picker (`showStartPicker`) controlled by both ends — the picker itself takes a single date and we wire it as the *start*. Per spec, partial overrides are allowed; in v1 we always edit the start side first, then the user can re-open to set the end. If this proves awkward in manual verification (Task 11), iterate then. The picker's "Reset to auto" link clears both sides at once, which is the cleanest revert.

- [ ] **Step 3: Smoke-render check**

```bash
npm run dev
```

The component isn't wired to overview.jsx yet. Quick check: open DevTools, no compile errors. Tests aren't applicable for these components — they're verified visually after Task 10 wires them in.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/overview/KpiTile.jsx src/renderer/src/overview/KpiBand.jsx
git commit -m "feat(overview): add KpiTile and KpiBand components"
```

---

## Task 5: ContributorByline + ContributorsModal

**Files:**
- Create: `src/renderer/src/overview/ContributorByline.jsx`
- Create: `src/renderer/src/overview/ContributorsModal.jsx`

The byline is purely presentational. The modal owns all the contributor CRUD state (add / edit / delete) extracted from the current `overview.jsx`. The modal opens when the user clicks any name or the "✎ Manage" link in the byline.

### Steps

- [ ] **Step 1: Create `ContributorByline.jsx`**

Create `src/renderer/src/overview/ContributorByline.jsx`:

```jsx
import { Pencil } from 'lucide-react'

const VISIBLE_COUNT = 3

/**
 * Compact byline like "By A · B · C +2 more · ✎ Manage".
 *
 * @param {Object} props
 * @param {Array<{title?: string, firstName?: string, lastName?: string, role?: string, organization?: string}>} props.contributors
 * @param {() => void} props.onManageClick - Opens the contributors modal.
 */
export default function ContributorByline({ contributors, onManageClick }) {
  const list = contributors || []

  if (list.length === 0) {
    return (
      <div className="text-[0.78rem] text-gray-500 mt-3 pt-3 border-t border-gray-100">
        No contributors yet
        <button
          type="button"
          onClick={onManageClick}
          className="ml-2 text-blue-600 hover:underline inline-flex items-center gap-1 text-[0.72rem]"
          title="Add contributor"
        >
          <Pencil size={11} />
          Add
        </button>
      </div>
    )
  }

  const visible = list.slice(0, VISIBLE_COUNT)
  const overflow = list.length - visible.length

  return (
    <div className="text-[0.78rem] text-gray-500 mt-3 pt-3 border-t border-gray-100 flex items-center gap-1.5 flex-wrap">
      <span className="text-gray-400">By</span>
      {visible.map((c, idx) => (
        <span key={idx} className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onManageClick}
            className="text-gray-600 hover:text-blue-600 hover:underline"
          >
            {displayName(c)}
          </button>
          {idx < visible.length - 1 && <span className="text-gray-300">·</span>}
        </span>
      ))}
      {overflow > 0 && (
        <>
          <span className="text-gray-300">·</span>
          <button
            type="button"
            onClick={onManageClick}
            className="text-gray-400 hover:text-blue-600 hover:underline"
          >
            +{overflow} more
          </button>
        </>
      )}
      <span className="text-gray-300">·</span>
      <button
        type="button"
        onClick={onManageClick}
        className="text-blue-600 hover:underline opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-1 text-[0.72rem]"
        title="Manage contributors"
      >
        <Pencil size={11} />
        Manage
      </button>
    </div>
  )
}

function displayName(c) {
  if (c.title) return c.title
  return `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unnamed'
}
```

The `group-hover` class on the Manage link relies on the parent `EditorialHeader` adding the `group` class — done in Task 9.

- [ ] **Step 2: Create `ContributorsModal.jsx`**

Create `src/renderer/src/overview/ContributorsModal.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Check, X, Plus } from 'lucide-react'

const CONTRIBUTOR_ROLES = [
  { value: 'contact', label: 'Contact' },
  { value: 'principalInvestigator', label: 'Principal Investigator' },
  { value: 'rightsHolder', label: 'Rights Holder' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'contributor', label: 'Contributor' }
]

const EMPTY_CONTRIBUTOR = { title: '', role: '', organization: '', email: '' }

/**
 * Modal owning all contributor CRUD state. Replaces the inline strip of cards.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.studyId
 * @param {Object} props.studyData - The full study data object.
 */
export default function ContributorsModal({ open, onClose, studyId, studyData }) {
  const queryClient = useQueryClient()
  const [editingIndex, setEditingIndex] = useState(null)
  const [editedContrib, setEditedContrib] = useState(null)
  const [adding, setAdding] = useState(false)
  const [newContrib, setNewContrib] = useState(EMPTY_CONTRIBUTOR)
  const [deletingIndex, setDeletingIndex] = useState(null)
  const dialogRef = useRef(null)

  const contributors = studyData?.contributors || []

  // Reset internal state when the modal closes.
  useEffect(() => {
    if (!open) {
      setEditingIndex(null)
      setEditedContrib(null)
      setAdding(false)
      setNewContrib(EMPTY_CONTRIBUTOR)
      setDeletingIndex(null)
    }
  }, [open])

  // Close on Escape (only when no nested confirmation is open).
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape' && deletingIndex === null) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, deletingIndex])

  if (!open) return null

  const startEdit = (i) => {
    setEditingIndex(i)
    setEditedContrib({ ...contributors[i] })
    setAdding(false)
  }

  const cancelEdit = () => {
    setEditingIndex(null)
    setEditedContrib(null)
  }

  const saveEdit = async (i) => {
    if (!editedContrib?.title?.trim()) return
    const updated = [...contributors]
    updated[i] = {
      ...editedContrib,
      title: editedContrib.title.trim(),
      organization: editedContrib.organization?.trim() || undefined,
      email: editedContrib.email?.trim() || undefined
    }
    await window.api.updateStudy(studyId, { data: { ...studyData, contributors: updated } })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    cancelEdit()
  }

  const remove = async (i) => {
    const updated = contributors.filter((_, idx) => idx !== i)
    await window.api.updateStudy(studyId, { data: { ...studyData, contributors: updated } })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    setDeletingIndex(null)
  }

  const addNew = async () => {
    if (!newContrib?.title?.trim()) return
    const toAdd = {
      title: newContrib.title.trim(),
      role: newContrib.role || undefined,
      organization: newContrib.organization?.trim() || undefined,
      email: newContrib.email?.trim() || undefined
    }
    const updated = [...contributors, toAdd]
    await window.api.updateStudy(studyId, { data: { ...studyData, contributors: updated } })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    setAdding(false)
    setNewContrib(EMPTY_CONTRIBUTOR)
  }

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (dialogRef.current && !dialogRef.current.contains(e.target)) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6"
      >
        <h3 className="text-lg font-medium mb-1">Manage contributors</h3>
        <p className="text-sm text-gray-500 mb-4">
          Researchers and organizations associated with this study.
        </p>

        <div className="flex flex-col gap-2">
          {contributors.map((c, i) =>
            editingIndex === i ? (
              <ContributorEditForm
                key={i}
                value={editedContrib}
                onChange={setEditedContrib}
                onSave={() => saveEdit(i)}
                onCancel={cancelEdit}
              />
            ) : (
              <div
                key={i}
                className="border border-gray-200 rounded-md px-3 py-2 flex items-start justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-900 truncate">
                    {c.title || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unnamed'}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {[friendlyRole(c.role), c.organization, c.email].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(i)}
                    className="p-1 hover:bg-gray-100 rounded text-gray-500"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingIndex(i)}
                    className="p-1 hover:bg-red-50 rounded text-red-600"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          )}

          {adding ? (
            <ContributorEditForm
              value={newContrib}
              onChange={setNewContrib}
              onSave={addNew}
              onCancel={() => {
                setAdding(false)
                setNewContrib(EMPTY_CONTRIBUTOR)
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(true)
                cancelEdit()
              }}
              className="border border-dashed border-blue-200 text-blue-600 rounded-md px-3 py-2 hover:border-blue-400 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1.5 text-sm"
            >
              <Plus size={14} />
              Add contributor
            </button>
          )}
        </div>

        <div className="flex justify-end mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
          >
            Done
          </button>
        </div>
      </div>

      {deletingIndex !== null && (
        <div
          className="fixed inset-0 z-[1100] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setDeletingIndex(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium mb-2">Delete contributor</h3>
            <p className="text-gray-600 text-sm mb-4">
              Are you sure you want to delete this contributor?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeletingIndex(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => remove(deletingIndex)}
                className="px-3 py-1.5 text-sm bg-red-600 text-white hover:bg-red-700 rounded"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ContributorEditForm({ value, onChange, onSave, onCancel }) {
  return (
    <div
      className="border border-blue-200 rounded-md px-3 py-2 flex flex-col gap-2 bg-blue-50/30"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onSave()
        } else if (e.key === 'Escape') {
          onCancel()
        }
      }}
    >
      <input
        type="text"
        value={value.title || ''}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
        className="border border-gray-300 rounded px-2 py-1 text-sm"
        placeholder="Name *"
        autoFocus
      />
      <select
        value={value.role || ''}
        onChange={(e) => onChange({ ...value, role: e.target.value })}
        className="border border-gray-300 rounded px-2 py-1 text-sm"
      >
        <option value="">Select role…</option>
        {CONTRIBUTOR_ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={value.organization || ''}
        onChange={(e) => onChange({ ...value, organization: e.target.value })}
        className="border border-gray-300 rounded px-2 py-1 text-sm"
        placeholder="Organization"
      />
      <input
        type="email"
        value={value.email || ''}
        onChange={(e) => onChange({ ...value, email: e.target.value })}
        className="border border-gray-300 rounded px-2 py-1 text-sm"
        placeholder="Email"
      />
      <div className="flex justify-end gap-1">
        <button onClick={onCancel} className="p-1 hover:bg-red-50 rounded text-red-600" title="Cancel">
          <X size={16} />
        </button>
        <button onClick={onSave} className="p-1 hover:bg-green-50 rounded text-green-600" title="Save">
          <Check size={16} />
        </button>
      </div>
    </div>
  )
}

function friendlyRole(role) {
  if (!role) return null
  const known = CONTRIBUTOR_ROLES.find((r) => r.value === role)
  if (known) return known.label
  return role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())
}
```

- [ ] **Step 3: Run lint + format**

```bash
npm run format -- src/renderer/src/overview/ContributorByline.jsx src/renderer/src/overview/ContributorsModal.jsx
npm run lint
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/overview/ContributorByline.jsx src/renderer/src/overview/ContributorsModal.jsx
git commit -m "feat(overview): add ContributorByline and ContributorsModal components"
```

---

## Task 6: BestMediaCarousel `renderEmpty` prop + BestCapturesSection wrapper

**Files:**
- Modify: `src/renderer/src/ui/BestMediaCarousel.jsx`
- Create: `src/renderer/src/overview/BestCapturesSection.jsx`

The carousel currently returns `null` when there's no media (`BestMediaCarousel.jsx:761`). We add an opt-in `renderEmpty` prop so the Overview tab can show a placeholder strip instead. Existing call sites (none today) keep the current null-return behavior by omitting the prop.

### Steps

- [ ] **Step 1: Add `renderEmpty` prop to `BestMediaCarousel`**

In `src/renderer/src/ui/BestMediaCarousel.jsx`:

Find the function signature at line 695:

**Before:**
```jsx
export default function BestMediaCarousel({ studyId, isRunning }) {
```

**After:**
```jsx
export default function BestMediaCarousel({ studyId, isRunning, renderEmpty }) {
```

Find the early-return at line 761-763:

**Before:**
```jsx
  // Hide carousel while loading, on error, or if no data
  if (isLoading || error || bestMedia.length === 0) {
    return null
  }
```

**After:**
```jsx
  // Hide carousel while loading or on error.
  if (isLoading || error) {
    return null
  }
  if (bestMedia.length === 0) {
    return renderEmpty ? renderEmpty() : null
  }
```

- [ ] **Step 2: Create `BestCapturesSection.jsx`**

Create `src/renderer/src/overview/BestCapturesSection.jsx`:

```jsx
import { Camera as CameraIcon } from 'lucide-react'
import BestMediaCarousel from '../ui/BestMediaCarousel'

/**
 * Best captures band — section header + carousel + polite empty state.
 * Renders even when the carousel has no items.
 */
export default function BestCapturesSection({ studyId, isRunning }) {
  return (
    <section>
      <h3 className="text-[0.7rem] uppercase tracking-wider text-gray-500 font-semibold mb-3">
        Best captures
      </h3>
      <BestMediaCarousel
        studyId={studyId}
        isRunning={isRunning}
        renderEmpty={() => (
          <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg px-4 py-6 text-sm text-gray-500 flex items-center justify-center gap-2">
            <CameraIcon size={16} className="text-gray-400" />
            Top captures will appear here after classification
          </div>
        )}
      />
    </section>
  )
}
```

- [ ] **Step 3: Run lint + format**

```bash
npm run format -- src/renderer/src/ui/BestMediaCarousel.jsx src/renderer/src/overview/BestCapturesSection.jsx
npm run lint
```

Expected: clean.

- [ ] **Step 4: Smoke test (optional, can defer to Task 11)**

Best validated end-to-end after Task 10 wires the section in. No isolated render path today.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/ui/BestMediaCarousel.jsx src/renderer/src/overview/BestCapturesSection.jsx
git commit -m "feat(overview): add BestCapturesSection wrapper with empty state"
```

---

## Task 7: SpeciesDistribution extraction (full-width restyle)

**Files:**
- Create: `src/renderer/src/overview/SpeciesDistribution.jsx`
- Modify: `src/renderer/src/overview.jsx` — remove the inline `SpeciesRow` and `SpeciesDistribution` component bodies. (Final wiring happens in Task 10.)

The current `SpeciesDistribution` (`overview.jsx:341-421`) and `SpeciesRow` (`overview.jsx:265-338`) are extracted as-is *plus* a restyle for full-width: name block becomes `w-64` (was unconstrained), the row becomes a flex layout with the IUCN badge + bar + count inline, and a section header is added.

### Steps

- [ ] **Step 1: Create `SpeciesDistribution.jsx`** (extracted + restyled)

Create `src/renderer/src/overview/SpeciesDistribution.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as HoverCard from '@radix-ui/react-hover-card'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import SpeciesTooltipContent from '../ui/SpeciesTooltipContent'
import IucnBadge from '../ui/IucnBadge'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'
import { useCommonName } from '../utils/commonNames'
import { sortSpeciesHumansLast } from '../utils/speciesUtils'

/**
 * Single species row. Restyled for the full-width Overview placement.
 */
function SpeciesRow({
  species,
  storedCommonName,
  speciesImageMap,
  studyId,
  totalCount,
  onRowClick,
  scrollSignal
}) {
  const displayName =
    useCommonName(species.scientificName, { storedCommonName }) || species.scientificName
  const showScientific = species.scientificName && displayName !== species.scientificName
  const info = resolveSpeciesInfo(species.scientificName)
  const iucn = info?.iucn
  const studyImage = speciesImageMap[species.scientificName]
  const tooltipImageData =
    studyImage || (info?.imageUrl ? { scientificName: species.scientificName } : null)
  const [hoverOpen, setHoverOpen] = useState(false)

  useEffect(() => {
    if (scrollSignal > 0) setHoverOpen(false)
  }, [scrollSignal])

  return (
    <HoverCard.Root
      key={species.scientificName}
      open={hoverOpen}
      onOpenChange={setHoverOpen}
      openDelay={200}
      closeDelay={120}
    >
      <HoverCard.Trigger asChild>
        <div
          className="cursor-pointer hover:bg-blue-50 transition-colors py-2 px-2 -mx-2 rounded flex items-center gap-3"
          onClick={() => onRowClick(species)}
        >
          <div className="w-64 min-w-0 truncate flex-shrink-0">
            <span className="capitalize text-sm text-gray-900 font-medium">{displayName}</span>
            {showScientific && (
              <span className="text-gray-400 text-xs italic ml-2">{species.scientificName}</span>
            )}
          </div>
          <IucnBadge category={iucn} />
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="bg-blue-600 h-full rounded-full"
              style={{ width: `${(species.count / totalCount) * 100}%` }}
            />
          </div>
          <span className="w-12 text-right text-sm text-gray-500 tabular-nums flex-shrink-0">
            {species.count}
          </span>
        </div>
      </HoverCard.Trigger>
      {tooltipImageData && (
        <HoverCard.Portal>
          <HoverCard.Content
            side="right"
            sideOffset={12}
            align="start"
            avoidCollisions={true}
            collisionPadding={16}
            className="z-[10000]"
          >
            <SpeciesTooltipContent imageData={tooltipImageData} studyId={studyId} />
          </HoverCard.Content>
        </HoverCard.Portal>
      )}
    </HoverCard.Root>
  )
}

/**
 * Full-width species distribution section. Pulls its own data + best-images.
 *
 * @param {Object} props
 * @param {string} props.studyId
 * @param {Object} props.speciesData - Sequence-aware species distribution.
 * @param {Object} props.taxonomicData - Taxonomic data from study metadata (for stored common names).
 */
export default function SpeciesDistribution({ studyId, speciesData, taxonomicData }) {
  const navigate = useNavigate()
  const [scrollSignal, setScrollSignal] = useState(0)
  const handleScroll = useCallback(() => setScrollSignal((s) => s + 1), [])

  const { data: bestImagesData } = useQuery({
    queryKey: ['bestImagesPerSpecies', studyId],
    queryFn: async () => {
      const response = await window.api.getBestImagePerSpecies(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    staleTime: 60000
  })

  const speciesImageMap = useMemo(() => {
    const map = {}
    if (bestImagesData) bestImagesData.forEach((item) => (map[item.scientificName] = item))
    return map
  }, [bestImagesData])

  const scientificToCommonMap = useMemo(() => {
    const map = {}
    if (taxonomicData && Array.isArray(taxonomicData)) {
      taxonomicData.forEach((taxon) => {
        if (taxon.scientificName && taxon?.vernacularNames?.eng) {
          map[taxon.scientificName] = taxon.vernacularNames.eng
        }
      })
    }
    return map
  }, [taxonomicData])

  const handleRowClick = (species) => {
    navigate(`/study/${studyId}/media?species=${encodeURIComponent(species.scientificName)}`)
  }

  return (
    <section className="flex flex-col min-h-0">
      <h3 className="text-[0.7rem] uppercase tracking-wider text-gray-500 font-semibold mb-3">
        Species distribution
      </h3>

      {!speciesData || speciesData.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg px-4 py-8 text-center">
          <p className="text-sm font-medium text-gray-600">No species detected yet</p>
          <p className="text-xs text-gray-500 mt-1">
            Run a classification model to see what's been captured.
          </p>
        </div>
      ) : (
        <div className="overflow-y-auto" onScroll={handleScroll}>
          {sortSpeciesHumansLast(speciesData).map((species) => {
            const totalCount = speciesData.reduce((sum, item) => sum + item.count, 0)
            const storedCommonName = scientificToCommonMap[species.scientificName] || null
            return (
              <SpeciesRow
                key={species.scientificName}
                species={species}
                storedCommonName={storedCommonName}
                speciesImageMap={speciesImageMap}
                studyId={studyId}
                totalCount={totalCount}
                onRowClick={handleRowClick}
                scrollSignal={scrollSignal}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
```

Note: `totalCount` is recomputed inside the map for clarity. Hoisting it out of the map with `useMemo` is a future optimization; keep the simple form for now.

- [ ] **Step 2: Run lint + format**

```bash
npm run format -- src/renderer/src/overview/SpeciesDistribution.jsx
npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/overview/SpeciesDistribution.jsx
git commit -m "feat(overview): extract and restyle SpeciesDistribution (full-width, empty state)"
```

The original `SpeciesRow` and `SpeciesDistribution` definitions stay in `overview.jsx` for now — they get removed in Task 10 when we swap the import.

---

## Task 8: DateTimePicker `onResetToAuto` prop

**Files:**
- Modify: `src/renderer/src/ui/DateTimePicker.jsx`

Add an optional `onResetToAuto` prop. When provided, the picker shows a "Reset to auto" link in its action row. When not provided, the picker behaves as today.

### Steps

- [ ] **Step 1: Add the prop and render the link**

In `src/renderer/src/ui/DateTimePicker.jsx`:

Update the JSDoc and signature at the top of the export:

**Before** (lines 4-20):
```jsx
/**
 * DateTimePicker component for editing ISO 8601 timestamps
 *
 * @param {Object} props
 * @param {string} props.value - ISO 8601 timestamp
 * @param {(newValue: string) => void} props.onChange - Called with new ISO timestamp on save
 * @param {() => void} props.onCancel - Called when picker is dismissed
 * @param {string} [props.className] - Additional CSS classes
 * @param {boolean} [props.dateOnly] - If true, hide time inputs and only show calendar
 */
export default function DateTimePicker({
  value,
  onChange,
  onCancel,
  className = '',
  dateOnly = false
}) {
```

**After:**
```jsx
/**
 * DateTimePicker component for editing ISO 8601 timestamps
 *
 * @param {Object} props
 * @param {string} props.value - ISO 8601 timestamp
 * @param {(newValue: string) => void} props.onChange - Called with new ISO timestamp on save
 * @param {() => void} props.onCancel - Called when picker is dismissed
 * @param {() => void} [props.onResetToAuto] - When provided, the picker shows a "Reset to auto" link that calls this handler. The handler should clear any persisted override so the value falls back to derivation.
 * @param {string} [props.className] - Additional CSS classes
 * @param {boolean} [props.dateOnly] - If true, hide time inputs and only show calendar
 */
export default function DateTimePicker({
  value,
  onChange,
  onCancel,
  onResetToAuto,
  className = '',
  dateOnly = false
}) {
```

Find the action row at the end of the picker — locate the existing `Cancel` button. The current action row sits roughly at lines 250-268. Insert the "Reset to auto" link as the leftmost action, only when `onResetToAuto` is provided.

Look for a block like:
```jsx
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onCancel}
            ...
          >
            Cancel
          </button>
          ...
        </div>
```

Wrap the inner content with a `flex` container that has `justify-between` when the reset link is present:

**Before** (the action row, exact markup may vary slightly):
```jsx
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onCancel} ...>Cancel</button>
          <button onClick={handleSave} ...>Save</button>
        </div>
```

**After:**
```jsx
        <div className={`flex items-center mt-3 ${onResetToAuto ? 'justify-between' : 'justify-end'} gap-2`}>
          {onResetToAuto && (
            <button
              type="button"
              onClick={onResetToAuto}
              className="text-xs text-blue-600 hover:underline"
              title="Clear override and fall back to auto-derived range"
            >
              Reset to auto
            </button>
          )}
          <div className="flex gap-2">
            <button onClick={onCancel} ...>Cancel</button>
            <button onClick={handleSave} ...>Save</button>
          </div>
        </div>
```

(Preserve the existing Cancel/Save class names exactly. Only the wrapping changes.)

- [ ] **Step 2: Smoke render**

```bash
npm run dev
```

Open any place that uses the picker today (e.g., the deployment date editor, until Task 10 wires the new path) — confirm the picker still renders without the reset link, and no regressions.

- [ ] **Step 3: Run format + lint**

```bash
npm run format -- src/renderer/src/ui/DateTimePicker.jsx
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/ui/DateTimePicker.jsx
git commit -m "feat(ui): DateTimePicker — optional Reset-to-auto link"
```

---

## Task 9: EditorialHeader composition

**Files:**
- Create: `src/renderer/src/overview/EditorialHeader.jsx`

The editorial header composes everything in the upper region: title (editable inline), description (editable inline), contributor byline + manage modal, and slot for the map. The hover state for affordances lives here — a single `group` class on the left column lets `ContributorByline`'s "Manage" link hide/reveal correctly.

This task **lifts editing state into the new component** (title and description state move out of `overview.jsx`), but it does not yet touch `overview.jsx`. Wiring happens in Task 10.

### Steps

- [ ] **Step 1: Create `EditorialHeader.jsx`**

Create `src/renderer/src/overview/EditorialHeader.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, ChevronDown, ChevronUp } from 'lucide-react'
import ContributorByline from './ContributorByline'
import ContributorsModal from './ContributorsModal'

/**
 * Editorial header — title + description + contributor byline (left column)
 * and a `mapSlot` (right column).
 *
 * Editing affordances are hidden until hover, surfaced via a single `group`
 * class on the left column.
 *
 * @param {Object} props
 * @param {string} props.studyId
 * @param {string} props.studyName
 * @param {Object} props.studyData - Full study `data` object (description, contributors, taxonomic, …).
 * @param {React.ReactNode} props.mapSlot - The right-column content (typically <DeploymentMap />).
 */
export default function EditorialHeader({ studyId, studyName, studyData, mapSlot }) {
  const queryClient = useQueryClient()

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const titleEditRef = useRef(null)

  // Description editing
  const [editingDescription, setEditingDescription] = useState(false)
  const [editedDescription, setEditedDescription] = useState('')
  const descRef = useRef(null)
  const descEditRef = useRef(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [descTruncated, setDescTruncated] = useState(false)

  // Contributors modal
  const [contributorsOpen, setContributorsOpen] = useState(false)

  const description = studyData?.description || ''

  // Click-outside to save title
  useEffect(() => {
    if (!editingTitle) return
    const onMouseDown = (e) => {
      if (titleEditRef.current && !titleEditRef.current.contains(e.target)) saveTitle()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTitle, editedTitle, studyName])

  // Click-outside / Escape for description
  useEffect(() => {
    if (!editingDescription) return
    const onMouseDown = (e) => {
      if (descEditRef.current && !descEditRef.current.contains(e.target)) saveDescription()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') cancelDescription()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingDescription, editedDescription])

  // Detect truncation for "Show more"
  useEffect(() => {
    if (!descRef.current || editingDescription) {
      setDescTruncated(false)
      return
    }
    const check = () => {
      const el = descRef.current
      if (el) setDescTruncated(el.scrollHeight > el.clientHeight)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [description, descExpanded, editingDescription])

  const startTitleEdit = () => {
    setEditedTitle(studyName)
    setEditingTitle(true)
  }
  const cancelTitle = () => {
    setEditingTitle(false)
    setEditedTitle('')
  }
  const saveTitle = async () => {
    if (editedTitle.trim() && editedTitle !== studyName) {
      await window.api.updateStudy(studyId, { name: editedTitle.trim() })
      queryClient.invalidateQueries({ queryKey: ['study'] })
      queryClient.invalidateQueries({ queryKey: ['studies'] })
    }
    cancelTitle()
  }

  const startDescriptionEdit = () => {
    setEditedDescription(description)
    setEditingDescription(true)
  }
  const cancelDescription = () => {
    setEditingDescription(false)
    setEditedDescription('')
  }
  const saveDescription = async () => {
    try {
      await window.api.updateStudy(studyId, {
        data: { ...studyData, description: editedDescription.trim() }
      })
      queryClient.invalidateQueries({ queryKey: ['study'] })
    } finally {
      cancelDescription()
    }
  }

  return (
    <header className="grid grid-cols-[55%_1fr] gap-6 mb-6">
      <div className="group flex flex-col">
        {/* Title */}
        <div className="flex items-baseline gap-2">
          {editingTitle ? (
            <div ref={titleEditRef} className="flex-1">
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle()
                  else if (e.key === 'Escape') cancelTitle()
                }}
                className="text-2xl font-semibold text-gray-900 bg-transparent border-b-2 border-blue-500 focus:outline-none w-full"
                autoFocus
              />
            </div>
          ) : (
            <>
              <a
                target="_blank"
                rel="noopener noreferrer"
                href={studyData?.homepage}
                className="text-2xl font-semibold text-gray-900 capitalize"
              >
                {studyName}
              </a>
              <button
                type="button"
                onClick={startTitleEdit}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 hover:bg-gray-100 rounded text-gray-400 transition-opacity"
                title="Edit title"
                aria-label="Edit title"
              >
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>

        {/* Description */}
        <div className="relative mt-2 flex-1">
          {editingDescription ? (
            <div ref={descEditRef}>
              <textarea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    saveDescription()
                  } else if (e.key === 'Escape') {
                    cancelDescription()
                  }
                }}
                className="w-full text-sm text-gray-700 leading-relaxed border-2 border-blue-500 rounded p-2 focus:outline-none resize-y min-h-[120px] max-w-prose"
                autoFocus
                placeholder="Camera trap dataset containing deployment information, media files metadata, and species observations collected during wildlife monitoring."
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={startDescriptionEdit}
              className="text-left w-full block max-w-prose px-2 py-1 -mx-2 rounded transition-colors group-hover:outline group-hover:outline-1 group-hover:outline-dashed group-hover:outline-blue-200"
              title="Edit description"
            >
              <div
                ref={descRef}
                className={`text-sm text-gray-700 leading-relaxed ${
                  !descExpanded ? 'line-clamp-5 overflow-hidden' : ''
                }`}
              >
                {description || (
                  <span className="text-gray-400 italic">
                    Camera trap dataset containing deployment information, media files metadata, and
                    species observations collected during wildlife monitoring.
                  </span>
                )}
              </div>
            </button>
          )}
          {!editingDescription && description && (descTruncated || descExpanded) && (
            <button
              type="button"
              onClick={() => setDescExpanded(!descExpanded)}
              className="text-gray-500 text-xs flex items-center hover:text-blue-700 transition-colors mt-1"
            >
              {descExpanded ? (
                <>
                  Show less
                  <ChevronUp size={14} className="ml-1" />
                </>
              ) : (
                <>
                  Show more
                  <ChevronDown size={14} className="ml-1" />
                </>
              )}
            </button>
          )}
        </div>

        {/* Byline */}
        <ContributorByline
          contributors={studyData?.contributors}
          onManageClick={() => setContributorsOpen(true)}
        />
      </div>

      <div className="h-56">{mapSlot}</div>

      <ContributorsModal
        open={contributorsOpen}
        onClose={() => setContributorsOpen(false)}
        studyId={studyId}
        studyData={studyData}
      />
    </header>
  )
}
```

- [ ] **Step 2: Run lint + format**

```bash
npm run format -- src/renderer/src/overview/EditorialHeader.jsx
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/overview/EditorialHeader.jsx
git commit -m "feat(overview): add EditorialHeader composing title, description, byline, map slot"
```

---

## Task 10: Refactor `overview.jsx` to wire the new components

**Files:**
- Modify: `src/renderer/src/overview.jsx`

This is the largest single edit. The `Overview` component shrinks from ~1300 LOC to ~250 LOC. We:
- Remove the inline `SpeciesRow`, `SpeciesDistribution` (extracted in Task 7).
- Remove all contributor CRUD state and the inline cards strip (extracted in Task 5).
- Remove the title/description editing state (extracted in Task 9 into `EditorialHeader`).
- Remove the temporal-dates editing state and the dead `renderTemporalData` function (replaced by KpiBand's Span tile).
- Keep `DeploymentMap` and its helpers (`LayerChangeHandler`, `FitBoundsOnResize`, `createClusterCustomIcon`) in this file.
- Compose `EditorialHeader` (passing `<DeploymentMap />` as `mapSlot`), `KpiBand`, `BestCapturesSection`, `SpeciesDistribution`.

### Steps

- [ ] **Step 1: Replace the entire file content**

Open `src/renderer/src/overview.jsx`. The plan is to replace the entire file. Instead of detailing every removed line, here is the complete new content. Read the file first, copy any in-line CONTRIBUTOR_ROLES / unrelated constants if any are needed elsewhere (none should be — they all moved into `ContributorsModal`).

Replace the file content with:

```jsx
import { useEffect, useRef } from 'react'
import ReactDOMServer from 'react-dom/server'
import L from 'leaflet'
import { LayersControl, MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { Camera, MapPin } from 'lucide-react'
import PlaceholderMap from './ui/PlaceholderMap'
import { useImportStatus } from '@renderer/hooks/import'
import { useQuery } from '@tanstack/react-query'
import { useSequenceGap } from './hooks/useSequenceGap'
import { useState } from 'react'
import EditorialHeader from './overview/EditorialHeader'
import KpiBand from './overview/KpiBand'
import BestCapturesSection from './overview/BestCapturesSection'
import SpeciesDistribution from './overview/SpeciesDistribution'

// ──────────────────────────────────────────────────────────────────────────
// DeploymentMap — kept here for now. Self-contained.
// ──────────────────────────────────────────────────────────────────────────

function LayerChangeHandler({ onLayerChange }) {
  const map = useMap()
  useEffect(() => {
    const handle = (e) => onLayerChange(e.name)
    map.on('baselayerchange', handle)
    return () => map.off('baselayerchange', handle)
  }, [map, onLayerChange])
  return null
}

function FitBoundsOnResize({ bounds }) {
  const map = useMap()
  const boundsRef = useRef(bounds)

  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])

  useEffect(() => {
    const container = map.getContainer()
    const userInteracted = { current: false }
    const markInteracted = () => {
      userInteracted.current = true
    }
    container.addEventListener('mousedown', markInteracted)
    container.addEventListener('wheel', markInteracted, { passive: true })
    container.addEventListener('touchstart', markInteracted, { passive: true })
    container.addEventListener('keydown', markInteracted)

    const observer = new ResizeObserver(() => {
      map.invalidateSize()
      if (!userInteracted.current && boundsRef.current) {
        map.fitBounds(boundsRef.current, { padding: [150, 150] })
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      container.removeEventListener('mousedown', markInteracted)
      container.removeEventListener('wheel', markInteracted)
      container.removeEventListener('touchstart', markInteracted)
      container.removeEventListener('keydown', markInteracted)
    }
  }, [map])

  return null
}

const createClusterCustomIcon = (cluster) => {
  const count = cluster.getChildCount()
  let size = 'small'
  if (count >= 10) size = 'medium'
  if (count >= 50) size = 'large'

  const sizeClasses = {
    small: 'w-8 h-8 text-xs',
    medium: 'w-10 h-10 text-sm',
    large: 'w-12 h-12 text-base'
  }

  const icon = L.divIcon({
    html: `<div class="flex items-center justify-center ${sizeClasses[size]} bg-blue-500 text-white rounded-full border-2 border-white shadow-lg font-semibold">${count}</div>`,
    className: 'custom-cluster-icon',
    iconSize: L.point(40, 40, true)
  })

  cluster.options.title = ''
  cluster.unbindTooltip()
  cluster.bindTooltip(`${count} deployments`, { direction: 'top', offset: [0, -15] })

  return icon
}

function DeploymentMap({ deployments, studyId }) {
  const mapLayerKey = `mapLayer:${studyId}`
  const [selectedLayer, setSelectedLayer] = useState(() => {
    const saved = localStorage.getItem(mapLayerKey)
    return saved || 'Satellite'
  })

  useEffect(() => {
    localStorage.setItem(mapLayerKey, selectedLayer)
  }, [selectedLayer, mapLayerKey])

  if (!deployments || deployments.length === 0) {
    return (
      <PlaceholderMap
        title="No Deployment Data"
        description="Set up deployments in the Deployments tab to see camera trap locations on this map."
        linkTo="/deployments"
        linkText="Go to Deployments"
        icon={MapPin}
        studyId={studyId}
      />
    )
  }

  const valid = deployments.filter((d) => d.latitude && d.longitude)

  if (valid.length === 0) {
    return (
      <PlaceholderMap
        title="No Geographic Coordinates"
        description="Set up deployment coordinates in the Deployments tab to see camera trap locations on this map."
        linkTo="/deployments"
        linkText="Go to Deployments"
        icon={MapPin}
        studyId={studyId}
      />
    )
  }

  const positions = valid.map((d) => [parseFloat(d.latitude), parseFloat(d.longitude)])
  const bounds = L.latLngBounds(positions)

  const formatDate = (s) => {
    if (!s) return 'N/A'
    return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  const cameraIcon = L.divIcon({
    html: ReactDOMServer.renderToString(
      <div className="camera-marker">
        <Camera color="#1E40AF" fill="#93C5FD" size={28} />
      </div>
    ),
    className: 'custom-camera-icon',
    iconSize: [18, 18],
    iconAnchor: [14, 14]
  })

  return (
    <div className="w-full h-full bg-white rounded border border-gray-200">
      <MapContainer
        key={studyId}
        bounds={bounds}
        boundsOptions={{ padding: [150, 150] }}
        style={{ height: '100%', width: '100%' }}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer name="Satellite" checked={selectedLayer === 'Satellite'}>
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Street Map" checked={selectedLayer === 'Street Map'}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        <LayerChangeHandler onLayerChange={setSelectedLayer} />
        <FitBoundsOnResize bounds={bounds} />
        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterCustomIcon}
          maxClusterRadius={50}
          spiderfyOnMaxZoom
          showCoverageOnHover={false}
          zoomToBoundsOnClick
          polygonOptions={{ opacity: 0 }}
          singleMarkerMode={false}
        >
          {valid.map((d) => (
            <Marker
              key={d.deploymentID}
              position={[parseFloat(d.latitude), parseFloat(d.longitude)]}
              icon={cameraIcon}
            >
              <Popup>
                <div>
                  <h3 className="text-base font-semibold">
                    {d.locationName || d.locationID || 'Unnamed Location'}
                  </h3>
                  <p className="text-sm">
                    {formatDate(d.deploymentStart)} - {formatDate(d.deploymentEnd)}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Overview — the editorial showcase tab.
// ──────────────────────────────────────────────────────────────────────────

export default function Overview({ data, studyId, studyName }) {
  const { importStatus } = useImportStatus(studyId)
  const { sequenceGap } = useSequenceGap(studyId)

  const { data: deploymentsData, error: deploymentsError } = useQuery({
    queryKey: ['deploymentLocations', studyId],
    queryFn: async () => {
      const response = await window.api.getDeploymentLocations(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    refetchInterval: importStatus?.isRunning ? 5000 : false
  })

  const { data: speciesData, error: speciesError } = useQuery({
    queryKey: ['sequenceAwareSpeciesDistribution', studyId, sequenceGap],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareSpeciesDistribution(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId && sequenceGap !== undefined,
    refetchInterval: importStatus?.isRunning ? 5000 : false,
    placeholderData: (prev) => prev,
    staleTime: Infinity
  })

  const error = speciesError?.message || deploymentsError?.message || null

  return (
    <div className="flex flex-col px-6 gap-6 h-full overflow-y-auto py-4">
      <EditorialHeader
        studyId={studyId}
        studyName={studyName}
        studyData={data}
        mapSlot={<DeploymentMap key={studyId} deployments={deploymentsData} studyId={studyId} />}
      />

      <KpiBand studyId={studyId} studyData={data} isImporting={importStatus?.isRunning} />

      <BestCapturesSection studyId={studyId} isRunning={importStatus?.isRunning} />

      <SpeciesDistribution
        studyId={studyId}
        speciesData={speciesData}
        taxonomicData={data?.taxonomic || null}
      />

      {error && <div className="text-red-500 text-sm">Error: {error}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Confirm imports & dev compile**

```bash
npm run dev
```

Open the Overview tab on a real study. Confirm:
- App compiles, no console errors.
- Title, description, contributors render in the editorial header.
- Map renders on the right of the header.
- KPI band shows 5 tiles with realistic numbers.
- Best captures section renders (carousel with items if classified, dashed empty placeholder if not).
- Species list renders full-width.

Don't worry about polish yet — Task 11 is the careful walkthrough.

- [ ] **Step 3: Run lint + format**

```bash
npm run format -- src/renderer/src/overview.jsx
npm run lint
```

Expected: clean. If there are unused imports flagged, remove them — but don't pull in unrelated cleanups.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/overview.jsx
git commit -m "refactor(overview): wire editorial layout (header, KPI band, captures, species)"
```

---

## Task 11: Manual UI verification

**Files:** none (verification only).

Walk through the Overview tab in the running app across the states the spec calls out. **No claim of "done" without observing each item.**

### Steps

- [ ] **Step 1: Run the dev app**

```bash
npm run dev
```

- [ ] **Step 2: Mature study (rich data) — verify the happy path**

Open a study with classified observations, multiple deployments, and best media.
- [ ] Editorial header: title clickable (opens homepage), description with Show more if long, byline showing 1-3 contributors with "+N more" if needed, "✎ Manage" link visible only on hover of the left column.
- [ ] Map: renders on the right at ~h-56, satellite layer toggle works, markers cluster, popups show.
- [ ] KPI band: 5 tiles, correct numbers, correct sub-details (`X threatened`, `across X locations`, `Jan 'YY – Mon 'YY`, `from X camera-days`, `photos & videos`).
- [ ] Best captures: carousel scrolls, image clicks open existing modal, favorite toggle works, video tiles render with thumbnail/badge.
- [ ] Species list: full-width rows, IUCN badges visible, hover reveals image card (when image exists), click navigates to `/study/<id>/media?species=<...>`.

- [ ] **Step 3: Fresh import (no ML run yet) — verify empty states**

Open or create a study with deployments + media but no observations.
- [ ] KPI band shows `—` for Species and Observations; cameras / locations / span / media still show numbers.
- [ ] Best captures shows the dashed placeholder strip ("Top captures will appear here after classification").
- [ ] Species list shows the dashed placeholder block ("No species detected yet — run a classification model to see what's been captured.").
- [ ] Map still renders (deployments have coordinates).

- [ ] **Step 4: Title editing**

- [ ] Hover the editorial header → faint pencil appears next to the title.
- [ ] Click the pencil OR the title text → input field, focused, current name pre-filled.
- [ ] Type, press Enter → saves; the new name shows in the tab/list.
- [ ] Edit again, press Escape → cancels with original name restored.
- [ ] Edit again, click outside → saves.

- [ ] **Step 5: Description editing**

- [ ] Hover the editorial header → description block shows a faint dashed outline.
- [ ] Click the description → textarea opens with current content.
- [ ] Type a longer description, press Cmd/Ctrl+Enter → saves.
- [ ] The "Show more" toggle appears when truncation occurs.
- [ ] Re-open, press Escape → cancels.
- [ ] Re-open, click outside → saves.

- [ ] **Step 6: Contributors — manage modal**

- [ ] Hover the editorial header → "✎ Manage" link visible at end of byline.
- [ ] Click any contributor name → modal opens.
- [ ] Click "Manage" → modal opens.
- [ ] Modal shows vertical list of contributors with edit/delete icons.
- [ ] Edit an existing one (Pencil) → inline form replaces the row, save with green check or Enter.
- [ ] Cancel an edit (red X or Escape) → row reverts.
- [ ] Add new contributor (dashed "+ Add contributor" button) → form, save, appears in list.
- [ ] Delete a contributor (Trash) → confirmation modal, confirm deletes, cancel keeps it.
- [ ] Click "Done" → modal closes; byline reflects the change.
- [ ] Empty contributors state: byline shows "No contributors yet · ✎ Add" with the pencil always visible.

- [ ] **Step 7: Date span editing**

- [ ] Hover the Span tile → pencil appears top-right of the tile.
- [ ] Click the tile → DateTimePicker opens, pre-filled with current effective start.
- [ ] Confirm the picker shows a "Reset to auto" link in the action row.
- [ ] Change the date, save → KPI tile updates; sub-line shows new range.
- [ ] Click "Reset to auto" → picker closes; tile shows the derivation-based value (which may differ).

- [ ] **Step 8: During import**

If possible, trigger an import and watch the Overview during it.
- [ ] KPI band, best captures, species list refresh approximately every 5 seconds.
- [ ] Map updates as new deployments come in.
- [ ] No "Loading model…" spinner blocks the page (it was removed; sections show their own empty states until data arrives).

- [ ] **Step 9: If anything is broken**

Fix it as a follow-up commit on this same task. Note the fix in the commit message:

```bash
git add <fixed-file>
git commit -m "fix(overview): <what was broken>"
```

- [ ] **Step 10: Run the full test suite once more**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 11: Mark task complete**

No commit for the manual verification itself. Move on to Task 12.

---

## Task 12: Documentation updates

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/ipc-api.md`
- Modify: `docs/database-schema.md`

### Steps

- [ ] **Step 1: Update `docs/ipc-api.md`**

Find the species or deployments section (any nearby spot is fine — keep it in alphabetical or thematic order). Add a new entry for the overview channel:

```markdown
### `overview:get-stats`

Returns consolidated stats for the Overview tab's KPI band.

- **Channel:** `overview:get-stats`
- **Renderer:** `window.api.getOverviewStats(studyId)`
- **Returns:** `{ data: { speciesCount, threatenedCount, cameraCount, locationCount, observationCount, cameraDays, mediaCount, derivedRange: { start, end } } }` or `{ error }`.

Threatened count is the number of distinct species whose IUCN category is in `{VU, EN, CR, EW, EX}` per the bundled `speciesInfo` dictionary.

`derivedRange.start` and `.end` are ISO date strings (YYYY-MM-DD) resolved independently using the chain: `metadata.startDate/endDate` (override) → `min/max(observations.eventStart)` → `deployments.deploymentStart/deploymentEnd` → `media.timestamp`. Returns `null` if no source has a value.
```

- [ ] **Step 2: Update `docs/architecture.md`**

Find the section listing renderer directories. Add an entry for the new `overview/` subdirectory:

```markdown
- `src/renderer/src/overview/` — components specific to the Overview tab:
  - `EditorialHeader.jsx` — title + description + contributor byline + map slot
  - `KpiBand.jsx` / `KpiTile.jsx` — 5-tile stats band
  - `ContributorByline.jsx` / `ContributorsModal.jsx` — compact byline + manage modal
  - `BestCapturesSection.jsx` — wrapper around `BestMediaCarousel` with empty state
  - `SpeciesDistribution.jsx` — full-width species list with IUCN + bar chart
  - `utils/formatStats.js` — KPI formatters
```

If `architecture.md` documents the `src/main/database/queries/` files, add `overview.js — overview-tab consolidated stats`.

- [ ] **Step 3: Update `docs/database-schema.md`**

Find the metadata table section. Add a note clarifying the override semantics now that the renderer auto-derives:

```markdown
- `startDate` / `endDate` — ISO date overrides for the study's date span. When both are set, the Overview tab's Span tile uses these. When unset, the value derives independently per side from `observations.eventStart`, then `deployments.deploymentStart/End`, then `media.timestamp`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md docs/ipc-api.md docs/database-schema.md
git commit -m "docs: overview tab revamp — IPC, architecture, and schema notes"
```

- [ ] **Step 5: Final test sweep**

```bash
npm test
```

Expected: all PASS.

---

## Done

Branch `arthur/ui-overview-tab-revamp` should now have ~12 focused commits implementing the spec end-to-end. Open a PR using the standard project workflow.
