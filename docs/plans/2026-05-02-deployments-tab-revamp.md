# Deployments Tab Revamp — Inline Media Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline media workspace to the Deployments tab. Selecting a deployment opens a bottom pane scoped to that deployment (full bbox / classification editing, same as the Media tab); deselecting closes it. Map and list move from a vertical stack into a horizontal split inside a top row. Per spec at `docs/specs/2026-05-02-deployments-tab-revamp-design.md`.

**Architecture:** Fourteen incremental tasks. Phase 1 (T1–T3) lands the backend `deploymentID` filter on the existing `getSequences` IPC, TDD'd at the SQL layer. Phase 2 (T4–T5) extracts the existing `Gallery` from `media.jsx` into a shared module so both tabs render the same code, then plumbs `deploymentID` through it. Phase 3 (T6–T7) adds the small new components (`DeploymentMediaGallery`, `DeploymentDetailPane`). Phase 4 (T8–T11) restructures `deployments.jsx`: URL-driven selection with a unit-tested hydration helper, the new vertical/horizontal panel layout, close affordances. Phase 5 (T12–T14) handles map-marker selection routing, docs, and a manual smoke pass.

**Tech Stack:** Electron + React 18 + Tailwind + lucide-react in the renderer (`src/renderer/src/`); Drizzle ORM + better-sqlite3 in main (`src/main/database/`); `@tanstack/react-query` for data; `react-resizable-panels` for layout; `react-router` for URL state; `node:test` + `node:assert/strict` for unit tests.

**Starting branch:** `arthur/deployments-tab-revamp` (already contains the spec commit).

**Worktree:** `.worktrees/deployments-tab-revamp` — `npm install` and `npm run test:rebuild` already done.

---

## File map

| File | Change |
|---|---|
| `src/main/database/queries/sequences.js` | **Modify** — `getMediaForSequencePagination` and `hasTimestampedMedia` accept `deploymentID` in their options; add one `WHERE` clause to every variant of the timestamped + null-timestamp branches. |
| `src/main/services/sequences/pagination.js` | **Modify** — destructure `deploymentID` from `filters` in `getPaginatedSequences`; thread through `fetchTimestampedSequences`, `fetchMoreForLargeSequence`, `fetchNullTimestampSequences`. |
| `test/main/database/queries/sequencesDeploymentFilter.test.js` | **Create** — TDD tests for the `deploymentID` filter at the DB layer (timestamped phase, null-timestamp phase, no-filter, invalid ID). |
| `test/main/services/sequences/paginationDeploymentFilter.test.js` | **Create** — integration test that `getPaginatedSequences` honors `filters.deploymentID` end-to-end. |
| `docs/ipc-api.md` | **Modify** — note `filters.deploymentID` on `sequences:get-paginated`. |
| `src/renderer/src/media/Gallery.jsx` | **Create** — shared module containing the extracted `Gallery`, `SequenceCard`, `ThumbnailCard`, `ImageModal`, `GalleryControls`, `ThumbnailBboxOverlay`, `DrawingOverlay`, `palette`, `failedMediaIds`. Re-exports `Gallery` (default) and `ImageModal` (named) for callers. |
| `src/renderer/src/media.jsx` | **Modify** — delete the moved sections; import `Gallery` from `./media/Gallery.jsx`; keep the `Activity` outer shell unchanged. |
| `src/renderer/src/media/DeploymentMediaGallery.jsx` | **Create** — thin wrapper that renders `<Gallery>` with pinned deployment-scoped filter inputs. |
| `src/renderer/src/deployments/DeploymentDetailPane.jsx` | **Create** — bottom-pane container with header strip (deployment name + ✕) and a body slot containing `<DeploymentMediaGallery>`. |
| `src/renderer/src/deployments/urlState.js` | **Create** — pure helpers `resolveSelectedDeployment(searchParams, deployments)` and `withDeploymentParam(searchParams, deploymentID \| null)`. |
| `test/renderer/deployments/urlState.test.js` | **Create** — TDD tests for the helpers (valid/invalid/missing param, group-id-as-deploymentID rejected). |
| `src/renderer/src/deployments.jsx` | **Modify** — outer `PanelGroup` becomes vertical with conditional bottom panel; inner top row becomes horizontal `PanelGroup` (map + list); selection state mirrored to `?deploymentID=…` via `useSearchParams`; ✕ / Esc / toggle clear it; group-header click does NOT set the param. |
| `docs/architecture.md` | **Modify** — note the new `deployments/` and `media/` subfolders, the `DeploymentDetailPane`, and the shared `Gallery` extraction in the renderer's component tree. |

The existing `LocationMap`, `LocationsList`, `DeploymentRow`, `LocationGroupHeader`, `EditableLocationName`, etc. inside `deployments.jsx` are **not** moved in this plan — they keep their current shapes and get rewired to new selection plumbing only. Splitting them into separate files is a separate concern.

---

## Task 1: Add `deploymentID` filter to `getMediaForSequencePagination` (TDD)

**Files:**
- Modify: `src/main/database/queries/sequences.js`
- Test: `test/main/database/queries/sequencesDeploymentFilter.test.js`

The query has a timestamped phase and a null-timestamp phase, each with four variants (no species / blanks-only / blanks+species / regular species). All variants need one extra `eq(media.deploymentID, filters.deploymentID)` predicate appended to their existing `and(...)` clause when `filters.deploymentID` is set. `hasTimestampedMedia` needs the same.

### Steps

- [ ] **Step 1: Write the failing tests**

Create `test/main/database/queries/sequencesDeploymentFilter.test.js`:

```js
/**
 * Tests for the deploymentID filter on getMediaForSequencePagination.
 *
 * Exercises both the timestamped phase and the null-timestamp phase, with
 * and without the filter. The 'no filter' case asserts the existing
 * behavior is preserved.
 */

import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getMediaForSequencePagination,
  hasTimestampedMedia,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia
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
    // not available, fine
  }

  testStudyId = `test-deploymentfilter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-deploymentfilter-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seed() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1',
      locationID: 'loc1',
      locationName: 'Site A',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 1,
      longitude: 1,
      cameraID: 'cam1'
    },
    d2: {
      deploymentID: 'd2',
      locationID: 'loc2',
      locationName: 'Site B',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 2,
      longitude: 2,
      cameraID: 'cam2'
    }
  })
  // d1 has 2 timestamped + 1 null-timestamp; d2 has 1 timestamped + 1 null-timestamp
  await insertMedia(manager, {
    'd1-a.jpg': {
      mediaID: 'd1-a',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
      filePath: '/d1-a.jpg',
      fileName: 'd1-a.jpg'
    },
    'd1-b.jpg': {
      mediaID: 'd1-b',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
      filePath: '/d1-b.jpg',
      fileName: 'd1-b.jpg'
    },
    'd1-null.jpg': {
      mediaID: 'd1-null',
      deploymentID: 'd1',
      timestamp: null,
      filePath: '/d1-null.jpg',
      fileName: 'd1-null.jpg'
    },
    'd2-a.jpg': {
      mediaID: 'd2-a',
      deploymentID: 'd2',
      timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'),
      filePath: '/d2-a.jpg',
      fileName: 'd2-a.jpg'
    },
    'd2-null.jpg': {
      mediaID: 'd2-null',
      deploymentID: 'd2',
      timestamp: null,
      filePath: '/d2-null.jpg',
      fileName: 'd2-null.jpg'
    }
  })
}

describe('getMediaForSequencePagination — deploymentID filter', () => {
  test('no filter: returns media from all deployments (timestamped phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null,
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {}
    })
    const ids = result.media.map((m) => m.mediaID).sort()
    assert.deepEqual(ids, ['d1-a', 'd1-b', 'd2-a'])
  })

  test('with deploymentID: only matching deployment (timestamped phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null,
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {},
      deploymentID: 'd1'
    })
    const ids = result.media.map((m) => m.mediaID).sort()
    assert.deepEqual(ids, ['d1-a', 'd1-b'])
  })

  test('with deploymentID: only matching deployment (null phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: { phase: 'null', offset: 0 },
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {},
      deploymentID: 'd1'
    })
    const ids = result.media.map((m) => m.mediaID).sort()
    assert.deepEqual(ids, ['d1-null'])
  })

  test('with non-existent deploymentID: empty result, no error', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null,
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {},
      deploymentID: 'does-not-exist'
    })
    assert.deepEqual(result.media, [])
  })
})

describe('hasTimestampedMedia — deploymentID filter', () => {
  test('no filter: true when any deployment has timestamped media', async () => {
    await seed()
    const result = await hasTimestampedMedia(testDbPath, {})
    assert.equal(result, true)
  })

  test('with deploymentID: false when that deployment has no timestamped media', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'Site A',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 1,
        longitude: 1,
        cameraID: 'cam1'
      }
    })
    await insertMedia(manager, {
      'd1-null.jpg': {
        mediaID: 'd1-null',
        deploymentID: 'd1',
        timestamp: null,
        filePath: '/d1-null.jpg',
        fileName: 'd1-null.jpg'
      }
    })
    const result = await hasTimestampedMedia(testDbPath, { deploymentID: 'd1' })
    assert.equal(result, false)
  })

  test('with deploymentID: true when that deployment has timestamped media', async () => {
    await seed()
    const result = await hasTimestampedMedia(testDbPath, { deploymentID: 'd1' })
    assert.equal(result, true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/main/database/queries/sequencesDeploymentFilter.test.js
```

Expected: failures (the function ignores the new option).

- [ ] **Step 3: Add the filter to `getMediaForSequencePagination` and `hasTimestampedMedia`**

In `src/main/database/queries/sequences.js`:

1. Update the destructure at the top of `getMediaForSequencePagination` (around line 46):

```js
const {
  cursor = null,
  batchSize = 200,
  species = [],
  dateRange = {},
  timeRange = {},
  deploymentID = null
} = options
```

2. Update the JSDoc above to mention the new option:

```js
 * @param {string} [options.deploymentID] - If set, only media for this deploymentID
```

3. Inside the timestamped phase, append to `timestampedConditions` once (after the existing `dateRange` / `timeRange` / cursor handling, before the species branches):

```js
if (deploymentID) {
  timestampedConditions.push(eq(media.deploymentID, deploymentID))
}
```

4. Inside the null-timestamp phase, append to `nullConditions` once (right after `const nullConditions = [isNull(media.timestamp)]`):

```js
if (deploymentID) {
  nullConditions.push(eq(media.deploymentID, deploymentID))
}
```

5. Same pattern in `hasTimestampedMedia`:

```js
const { species = [], dateRange = {}, timeRange = {}, deploymentID = null } = options
// ...
const conditions = [isNotNull(media.timestamp)]
if (deploymentID) {
  conditions.push(eq(media.deploymentID, deploymentID))
}
```

The existing `species.length === 0` / blanks-only / mixed / regular branches all consume `timestampedConditions` (or `nullConditions`) via `and(...)`, so the single push covers every variant.

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/main/database/queries/sequencesDeploymentFilter.test.js
```

Expected: all pass.

- [ ] **Step 5: Run the full DB query test suite to verify no regressions**

```bash
node --test 'test/main/database/queries/**/*.test.js'
```

Expected: all pass (existing sequences-aware species-counts tests, overview-stats tests, etc., still pass).

- [ ] **Step 6: Commit**

```bash
git add src/main/database/queries/sequences.js \
        test/main/database/queries/sequencesDeploymentFilter.test.js
git commit -m "feat(db): add deploymentID filter to sequences query"
```

---

## Task 2: Thread `deploymentID` through the pagination service

**Files:**
- Modify: `src/main/services/sequences/pagination.js`
- Test: `test/main/services/sequences/paginationDeploymentFilter.test.js`

`getPaginatedSequences` extracts `species`, `dateRange`, `timeRange` from `filters`. Add `deploymentID` to the same path so the renderer's `getSequences(studyId, { filters: { deploymentID } })` reaches the SQL layer.

### Steps

- [ ] **Step 1: Write the failing test**

Create `test/main/services/sequences/paginationDeploymentFilter.test.js`:

```js
/**
 * End-to-end test for filters.deploymentID through getPaginatedSequences.
 *
 * Verifies the filter threads from the pagination service through to the SQL
 * layer and that returned sequences only contain media from the filtered
 * deployment.
 */

import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia
} from '../../../../src/main/database/index.js'
import { getPaginatedSequences } from '../../../../src/main/services/sequences/pagination.js'

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    // not available, fine
  }
  testStudyId = `test-pagination-deploymentfilter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-pagination-deployment-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

describe('getPaginatedSequences — filters.deploymentID', () => {
  test('returns only sequences for the filtered deployment', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'Site A',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 1,
        longitude: 1,
        cameraID: 'cam1'
      },
      d2: {
        deploymentID: 'd2',
        locationID: 'loc2',
        locationName: 'Site B',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 2,
        longitude: 2,
        cameraID: 'cam2'
      }
    })
    await insertMedia(manager, {
      'd1-a.jpg': {
        mediaID: 'd1-a',
        deploymentID: 'd1',
        timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
        filePath: '/d1-a.jpg',
        fileName: 'd1-a.jpg'
      },
      'd2-a.jpg': {
        mediaID: 'd2-a',
        deploymentID: 'd2',
        timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
        filePath: '/d2-a.jpg',
        fileName: 'd2-a.jpg'
      }
    })

    const result = await getPaginatedSequences(testDbPath, {
      gapSeconds: 60,
      limit: 50,
      cursor: null,
      filters: { deploymentID: 'd1' }
    })

    const allMediaIDs = result.sequences
      .flatMap((seq) => seq.items)
      .map((item) => item.mediaID)
    assert.deepEqual(allMediaIDs.sort(), ['d1-a'])
  })

  test('no deploymentID: returns sequences from all deployments', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'Site A',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 1,
        longitude: 1,
        cameraID: 'cam1'
      },
      d2: {
        deploymentID: 'd2',
        locationID: 'loc2',
        locationName: 'Site B',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 2,
        longitude: 2,
        cameraID: 'cam2'
      }
    })
    await insertMedia(manager, {
      'd1-a.jpg': {
        mediaID: 'd1-a',
        deploymentID: 'd1',
        timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
        filePath: '/d1-a.jpg',
        fileName: 'd1-a.jpg'
      },
      'd2-a.jpg': {
        mediaID: 'd2-a',
        deploymentID: 'd2',
        timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
        filePath: '/d2-a.jpg',
        fileName: 'd2-a.jpg'
      }
    })

    const result = await getPaginatedSequences(testDbPath, {
      gapSeconds: 60,
      limit: 50,
      cursor: null,
      filters: {}
    })

    const allMediaIDs = result.sequences
      .flatMap((seq) => seq.items)
      .map((item) => item.mediaID)
    assert.deepEqual(allMediaIDs.sort(), ['d1-a', 'd2-a'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/main/services/sequences/paginationDeploymentFilter.test.js
```

Expected: the deploymentID filter test fails (filter is ignored at the service layer); the no-filter test passes.

- [ ] **Step 3: Thread `deploymentID` through `pagination.js`**

In `src/main/services/sequences/pagination.js`:

1. In `getPaginatedSequences`, destructure `deploymentID`:

```js
const { species = [], dateRange = {}, timeRange = {}, deploymentID = null } = filters
```

2. In the `hasTimestampedMedia` call inside the no-cursor path:

```js
const hasTimestamped = await hasTimestampedMedia(dbPath, {
  species, dateRange, timeRange, deploymentID
})
```

3. In the `fetchTimestampedSequences` call options object:

```js
const result = await fetchTimestampedSequences(dbPath, {
  gapSeconds, limit, cursor, species, dateRange, timeRange, deploymentID
})
```

4. In the `fetchNullTimestampSequences` call options object:

```js
const result = await fetchNullTimestampSequences(dbPath, {
  limit: remainingLimit, offset, species, dateRange, timeRange, deploymentID
})
```

5. In `fetchTimestampedSequences`, destructure and forward:

```js
const { gapSeconds, limit, cursor, species, dateRange, timeRange, deploymentID } = options
// ...
const dbResult = await getMediaForSequencePagination(dbPath, {
  cursor, batchSize, species, dateRange, timeRange, deploymentID
})
```

Also forward to `fetchMoreForLargeSequence`:

```js
return await fetchMoreForLargeSequence(dbPath, {
  gapSeconds, limit, cursor, species, dateRange, timeRange, deploymentID,
  existingMedia: mediaItems, batchSize
})
```

6. In `fetchMoreForLargeSequence`, destructure and forward in both `getMediaForSequencePagination` calls:

```js
const { gapSeconds, limit, species, dateRange, timeRange, deploymentID,
        existingMedia, batchSize } = options
// ... both calls below this need `deploymentID` added to their options object
```

7. In `fetchNullTimestampSequences`, destructure and forward:

```js
const { limit, offset, species, deploymentID } = options
// ...
const dbResult = await getMediaForSequencePagination(dbPath, {
  cursor: { phase: 'null', offset },
  batchSize: limit,
  species,
  dateRange: {},
  timeRange: {},
  deploymentID
})
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/main/services/sequences/paginationDeploymentFilter.test.js
```

Expected: both tests pass.

- [ ] **Step 5: Run the full sequences test suite to verify no regressions**

```bash
node --test 'test/main/services/sequences/**/*.test.js' 'test/main/database/queries/**/*.test.js'
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/sequences/pagination.js \
        test/main/services/sequences/paginationDeploymentFilter.test.js
git commit -m "feat(sequences): thread deploymentID filter through pagination service"
```

---

## Task 3: Document the IPC change

**Files:**
- Modify: `docs/ipc-api.md`

### Steps

- [ ] **Step 1: Find the existing `sequences:get-paginated` entry**

```bash
grep -n "sequences:get-paginated\|getSequences" docs/ipc-api.md
```

- [ ] **Step 2: Add a one-line note to the `filters` field documentation**

In the `getSequences(studyId, options)` / `sequences:get-paginated` section, add `deploymentID?: string — if set, only media from this deployment` to the documented `filters` shape, alongside the existing `species`, `dateRange`, `timeRange` entries. Keep the surrounding prose untouched.

- [ ] **Step 3: Commit**

```bash
git add docs/ipc-api.md
git commit -m "docs(ipc): document filters.deploymentID on sequences:get-paginated"
```

---

## Task 4: Extract `Gallery` and friends from `media.jsx` into a shared module (refactor)

**Files:**
- Create: `src/renderer/src/media/Gallery.jsx`
- Modify: `src/renderer/src/media.jsx`

Pure refactor. Move `DrawingOverlay`, `ImageModal`, `GalleryControls`, `ThumbnailBboxOverlay`, `ThumbnailCard`, `SequenceCard`, `Gallery`, plus the module-level helpers `palette` and `failedMediaIds` into a new file. The `Activity` default export stays in `media.jsx` and imports `Gallery` from the new module. No behavior change.

Verification is by **running existing tests + manually loading the Media tab** because the React components are not unit-tested in this codebase. The end-of-task smoke check is critical.

### Steps

- [ ] **Step 1: Identify the moved code**

Open `src/renderer/src/media.jsx` and locate:
- `function DrawingOverlay` (~line 58)
- `function ImageModal` (~line 206)
- `const palette = [...]` (~line 1478)
- `function GalleryControls` (~line 1489)
- `function ThumbnailBboxOverlay` (~line 1572)
- `function ThumbnailCard` (~line 1636)
- `function SequenceCard` (~line 1808)
- `const failedMediaIds = new Set()` (~line 2072)
- `function Gallery` (~line 2087)

Everything from `function DrawingOverlay` down to the end of `function Gallery` (just before `export default function Activity`) moves. Helpers used only by these components (e.g. `palette`, `failedMediaIds`) move too.

- [ ] **Step 2: Create the new shared module**

Create `src/renderer/src/media/Gallery.jsx`:

```jsx
/**
 * Shared Gallery + ImageModal + supporting components.
 *
 * Used by:
 *   - src/renderer/src/media.jsx (the Media tab — study-wide)
 *   - src/renderer/src/media/DeploymentMediaGallery.jsx (the Deployments tab — deployment-scoped)
 *
 * Both consumers pass species/date/time filter inputs. The deployment-scoped
 * consumer additionally passes a deploymentID, which threads through to the
 * sequences query.
 */

// Re-host every import the moved code uses. The set is the union of imports
// currently at the top of media.jsx — copy those that any moved component
// references and drop the rest.
import {
  CameraOff, X, Calendar, Pencil, Check, Clock, Eye, EyeOff, SquarePlus,
  Layers, Play, Loader2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Heart, ZoomIn, ZoomOut, RotateCcw, Info
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation, useInfiniteQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import * as Tooltip from '@radix-ui/react-tooltip'
import EditableBbox from '../ui/EditableBbox'
import VideoBboxOverlay from '../ui/VideoBboxOverlay.jsx'
import ObservationRail from '../ui/ObservationRail'
import BboxLabelMinimal from '../ui/BboxLabelMinimal'
import {
  getImageBounds,
  screenToNormalized,
  screenToNormalizedWithZoom
} from '../utils/bboxCoordinates'
import { useZoomPan } from '../hooks/useZoomPan'
import { useImagePrefetch } from '../hooks/useImagePrefetch'
import {
  getSpeciesCountsFromBboxes,
  getSpeciesCountsFromSequence
} from '../utils/speciesFromBboxes'
import { SpeciesCountLabel } from '../ui/SpeciesLabel'
import { formatGridTimestamp } from '../utils/formatTimestamp'
import { useSequenceGap } from '../hooks/useSequenceGap'

// === Paste DrawingOverlay verbatim from media.jsx ===

// === Paste ImageModal verbatim from media.jsx ===

// === Paste palette verbatim from media.jsx ===

// === Paste GalleryControls verbatim from media.jsx ===

// === Paste ThumbnailBboxOverlay verbatim from media.jsx ===

// === Paste ThumbnailCard verbatim from media.jsx ===

// === Paste SequenceCard verbatim from media.jsx ===

// === Paste failedMediaIds verbatim from media.jsx ===

// === Paste Gallery verbatim from media.jsx ===

export { ImageModal }
export default Gallery
```

> **Note for implementer:** "Verbatim" here means the function bodies do not change. Internal references between moved functions (e.g. `Gallery` calling `SequenceCard`) work because they share scope inside the new file. Imports inside the moved code that reference siblings (e.g. `<ImageModal>` inside `Gallery`) need no rework — both live in this file now.

- [ ] **Step 3: Delete the moved code from `media.jsx`**

In `src/renderer/src/media.jsx`:
1. Remove the function declarations and helper constants listed in Step 1.
2. Remove top-of-file imports that are no longer used (e.g. icons that only the moved components used). Run lint to confirm what's unused.
3. Add a single import at the top:

```jsx
import Gallery from './media/Gallery'
```

If the `Activity` default export uses `ImageModal` directly (it does not — `ImageModal` is rendered only inside `Gallery`), no other import is needed.

- [ ] **Step 4: Run lint to catch dangling imports**

```bash
npm run lint -- --quiet
```

Expected: clean. If any "no-unused-vars" warnings fire on imports, remove them.

- [ ] **Step 5: Run the full test suite**

```bash
npm run test:rebuild && node --test 'test/**/*.test.js'
```

Expected: same pass count as before this task. If any test was inadvertently broken by the move (e.g. one that imports `media.jsx` and expects a now-removed named export), fix the import path to point at the new module.

- [ ] **Step 6: Manual smoke — Media tab**

```bash
npm run dev
```

In the running app:
1. Open a study with media.
2. Switch to the Media tab.
3. Verify: gallery loads, thumbnails render, clicking a thumbnail opens the image modal, bbox editing works, species filter works, timeline brushing works, daily-activity radar renders.

If any of those break, the import paths or moved-code scope is wrong — debug before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/media.jsx src/renderer/src/media/Gallery.jsx
git commit -m "refactor(media): extract Gallery + supporting components into shared module"
```

---

## Task 5: Add `deploymentID` prop to `Gallery`

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx`

`Gallery` already accepts `species`, `dateRange`, `timeRange`, `includeNullTimestamps`, `speciesReady`. Add a `deploymentID` prop, include it in the `useInfiniteQuery` queryKey, and pass it into the `getSequences` call's `filters`.

### Steps

- [ ] **Step 1: Add the prop**

In `Gallery`'s function signature:

```jsx
function Gallery({
  species,
  dateRange,
  timeRange,
  includeNullTimestamps = false,
  speciesReady = false,
  deploymentID = null
}) {
```

- [ ] **Step 2: Include `deploymentID` in the queryKey**

Find the `useInfiniteQuery` call inside `Gallery` (it currently has a `queryKey` like `['sequences', id, sequenceGap, JSON.stringify(species), ...]`). Insert `deploymentID` into the array:

```jsx
queryKey: [
  'sequences',
  id,
  sequenceGap,
  deploymentID,
  JSON.stringify(species),
  dateRange[0]?.toISOString(),
  dateRange[1]?.toISOString(),
  timeRange.start,
  timeRange.end,
  includeNullTimestamps
],
```

- [ ] **Step 3: Pass `deploymentID` into the query call**

In the same `useInfiniteQuery`'s `queryFn`:

```jsx
const response = await window.api.getSequences(id, {
  gapSeconds: sequenceGap,
  limit: PAGE_SIZE,
  cursor: pageParam,
  filters: {
    species,
    dateRange: dateRange[0] && dateRange[1] ? { start: dateRange[0], end: dateRange[1] } : {},
    timeRange,
    deploymentID
  }
})
```

- [ ] **Step 4: Run lint**

```bash
npm run lint -- --quiet
```

Expected: clean.

- [ ] **Step 5: Manual smoke — Media tab still works**

```bash
npm run dev
```

In the running app, switch to the Media tab. Verify the gallery still loads and behaves as before (no `deploymentID` prop is passed by the Media tab's `Activity`, so `null` flows through and the existing behavior is preserved).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/media/Gallery.jsx
git commit -m "feat(media): Gallery accepts optional deploymentID filter"
```

---

## Task 6: Create `DeploymentMediaGallery` wrapper

**Files:**
- Create: `src/renderer/src/media/DeploymentMediaGallery.jsx`

Thin wrapper that pins all the filter inputs `Gallery` expects and passes the deployment ID through.

### Steps

- [ ] **Step 1: Create the file**

Create `src/renderer/src/media/DeploymentMediaGallery.jsx`:

```jsx
/**
 * Deployment-scoped media gallery — used inside the Deployments tab's
 * detail pane.
 *
 * Wraps the shared Gallery with all filter inputs pinned. The sequences
 * query treats an empty species array as "no species filter — all media"
 * (see src/main/database/queries/sequences.js). speciesReady is passed
 * true because the wrapper has no species cascade to wait on.
 */
import Gallery from './Gallery'

export default function DeploymentMediaGallery({ deploymentID }) {
  return (
    <Gallery
      species={[]}
      dateRange={[null, null]}
      timeRange={{ start: 0, end: 24 }}
      includeNullTimestamps={true}
      speciesReady={true}
      deploymentID={deploymentID}
    />
  )
}
```

- [ ] **Step 2: Run lint**

```bash
npm run lint -- --quiet
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/media/DeploymentMediaGallery.jsx
git commit -m "feat(media): add DeploymentMediaGallery wrapper"
```

---

## Task 7: Create `DeploymentDetailPane` container

**Files:**
- Create: `src/renderer/src/deployments/DeploymentDetailPane.jsx`

Thin container with a header strip (deployment name + ✕ close button) and a body that renders `DeploymentMediaGallery`. Designed so future sections (timeline graph, camera-days, species at location) slot in as additional body children — but those are out of scope here.

### Steps

- [ ] **Step 1: Create the file**

Create `src/renderer/src/deployments/DeploymentDetailPane.jsx`:

```jsx
import { X } from 'lucide-react'
import DeploymentMediaGallery from '../media/DeploymentMediaGallery'

/**
 * Bottom-pane container for the Deployments tab. Mounted only when a
 * deployment is selected. Header shows the deployment name and a close
 * button. Body for V1 contains DeploymentMediaGallery; later additions
 * (timeline graph, camera-days, species at location) slot in as siblings
 * inside the body.
 */
export default function DeploymentDetailPane({ deployment, onClose }) {
  const title = deployment.locationName || deployment.locationID || deployment.deploymentID

  return (
    <div className="flex flex-col h-full bg-white border-t border-gray-200 min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-700 truncate" title={title}>
          {title} — media
        </h2>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
          title="Close (Esc)"
          aria-label="Close media pane"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <DeploymentMediaGallery deploymentID={deployment.deploymentID} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run lint**

```bash
npm run lint -- --quiet
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/deployments/DeploymentDetailPane.jsx
git commit -m "feat(deployments): add DeploymentDetailPane container"
```

---

## Task 8: Add URL hydration helpers (TDD)

**Files:**
- Create: `src/renderer/src/deployments/urlState.js`
- Test: `test/renderer/deployments/urlState.test.js`

Two pure helpers that the Deployments orchestrator uses to mirror selection in the URL. Unit-testable independent of React.

### Steps

- [ ] **Step 1: Write the failing tests**

Create `test/renderer/deployments/urlState.test.js`:

```js
/**
 * Tests for the URL state helpers used by the Deployments tab to mirror
 * selectedDeployment in ?deploymentID=…
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveSelectedDeployment,
  withDeploymentParam
} from '../../../src/renderer/src/deployments/urlState.js'

describe('resolveSelectedDeployment', () => {
  const deployments = [
    { deploymentID: 'd1', locationID: 'loc1' },
    { deploymentID: 'd2', locationID: 'loc2' }
  ]

  test('returns null when no param is set', () => {
    const params = new URLSearchParams('')
    assert.equal(resolveSelectedDeployment(params, deployments), null)
  })

  test('returns the matching deployment when param is set and valid', () => {
    const params = new URLSearchParams('deploymentID=d2')
    const result = resolveSelectedDeployment(params, deployments)
    assert.equal(result.deploymentID, 'd2')
  })

  test('returns null when the deploymentID is not in the list', () => {
    const params = new URLSearchParams('deploymentID=does-not-exist')
    assert.equal(resolveSelectedDeployment(params, deployments), null)
  })

  test('returns null when the param is empty', () => {
    const params = new URLSearchParams('deploymentID=')
    assert.equal(resolveSelectedDeployment(params, deployments), null)
  })

  test('returns null when the param matches a locationID only', () => {
    const params = new URLSearchParams('deploymentID=loc1')
    assert.equal(resolveSelectedDeployment(params, deployments), null)
  })

  test('returns null when deployments list is null/undefined', () => {
    const params = new URLSearchParams('deploymentID=d1')
    assert.equal(resolveSelectedDeployment(params, null), null)
    assert.equal(resolveSelectedDeployment(params, undefined), null)
  })
})

describe('withDeploymentParam', () => {
  test('sets the param when given a deploymentID', () => {
    const params = new URLSearchParams('foo=bar')
    const next = withDeploymentParam(params, 'd1')
    assert.equal(next.get('deploymentID'), 'd1')
    assert.equal(next.get('foo'), 'bar')
  })

  test('removes the param when given null', () => {
    const params = new URLSearchParams('deploymentID=d1&foo=bar')
    const next = withDeploymentParam(params, null)
    assert.equal(next.has('deploymentID'), false)
    assert.equal(next.get('foo'), 'bar')
  })

  test('overwrites an existing param', () => {
    const params = new URLSearchParams('deploymentID=d1')
    const next = withDeploymentParam(params, 'd2')
    assert.equal(next.get('deploymentID'), 'd2')
  })

  test('returns a new URLSearchParams (does not mutate input)', () => {
    const params = new URLSearchParams('deploymentID=d1')
    const next = withDeploymentParam(params, 'd2')
    assert.equal(params.get('deploymentID'), 'd1')
    assert.notEqual(next, params)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/renderer/deployments/urlState.test.js
```

Expected: failures (`urlState.js` doesn't exist).

- [ ] **Step 3: Implement the helpers**

Create `src/renderer/src/deployments/urlState.js`:

```js
/**
 * URL state helpers for the Deployments tab.
 *
 * The selected deployment is mirrored in ?deploymentID=… so deep links
 * round-trip and back/forward work. Group-header selections are list-only
 * state and are NOT mirrored.
 */

/**
 * Resolve the selected deployment from search params and the loaded
 * deployments list. Returns null when:
 *   - the param is missing or empty
 *   - the deployment ID isn't in the loaded list (deleted, wrong study,
 *     stale link)
 *   - the deployments list isn't loaded yet
 *
 * @param {URLSearchParams} searchParams
 * @param {Array<{deploymentID: string}>|null|undefined} deployments
 * @returns {object|null} The matching deployment object or null
 */
export function resolveSelectedDeployment(searchParams, deployments) {
  const id = searchParams.get('deploymentID')
  if (!id) return null
  if (!Array.isArray(deployments)) return null
  return deployments.find((d) => d.deploymentID === id) || null
}

/**
 * Return a new URLSearchParams with the deploymentID set (when given a
 * value) or removed (when given null). Does not mutate the input.
 *
 * @param {URLSearchParams} searchParams
 * @param {string|null} deploymentID
 * @returns {URLSearchParams}
 */
export function withDeploymentParam(searchParams, deploymentID) {
  const next = new URLSearchParams(searchParams)
  if (deploymentID) {
    next.set('deploymentID', deploymentID)
  } else {
    next.delete('deploymentID')
  }
  return next
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/renderer/deployments/urlState.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/deployments/urlState.js \
        test/renderer/deployments/urlState.test.js
git commit -m "feat(deployments): add URL state helpers"
```

---

## Task 9: Wire selection through the URL in `Deployments`

**Files:**
- Modify: `src/renderer/src/deployments.jsx`

Replace `useState(null)` for `selectedLocation` with a derivation from `useSearchParams`. All existing handlers that called `setSelectedLocation` now write the URL param via `withDeploymentParam`.

This task is wiring only — no layout change yet. The new `DeploymentDetailPane` is not yet mounted; the goal is to verify that selection state is fully URL-driven without breaking existing behavior (highlighted row, marker active state, scroll-to behavior, place mode).

### Steps

- [ ] **Step 1: Import the helpers and `useSearchParams`**

At the top of `src/renderer/src/deployments.jsx`, add:

```jsx
import { useSearchParams } from 'react-router'
import { resolveSelectedDeployment, withDeploymentParam } from './deployments/urlState'
```

- [ ] **Step 2: Replace the `selectedLocation` state with URL-derived state**

Inside `function Deployments({ studyId })`, replace:

```jsx
const [selectedLocation, setSelectedLocation] = useState(null)
```

with:

```jsx
const [searchParams, setSearchParams] = useSearchParams()
const selectedLocation = useMemo(
  () => resolveSelectedDeployment(searchParams, deploymentsList),
  [searchParams, deploymentsList]
)
const setSelectedLocation = useCallback(
  (location) => {
    setSearchParams(
      withDeploymentParam(searchParams, location?.deploymentID ?? null),
      { replace: true }
    )
  },
  [searchParams, setSearchParams]
)
```

> **Why `replace: true`:** selecting deployments shouldn't clutter browser history. Each click would otherwise push a new entry.

- [ ] **Step 3: Verify the existing call sites still type-check**

`onSelect`, `setSelectedLocation` references inside `LocationsList`, `DeploymentRow`, `LocationGroupHeader`, and `LocationMap` already pass deployment objects (with a `deploymentID` field) — the new wrapper accepts the same shape. No call-site changes needed.

`null` passes for "deselect" — the existing place-mode flow that calls `setSelectedLocation(null)` (if any) keeps working because `withDeploymentParam(params, null)` removes the param.

- [ ] **Step 4: Lint**

```bash
npm run lint -- --quiet
```

Expected: clean.

- [ ] **Step 5: Manual smoke — selection still works**

```bash
npm run dev
```

In the running app, switch to the Deployments tab. Verify:
1. Clicking a list row highlights it (URL gains `?deploymentID=…`).
2. Clicking a map marker selects the corresponding row.
3. URL deep-link: copy the URL, paste into a new window/tab — the same row is highlighted on load.
4. Place mode (drag-to-set-coords): still works.

> **Note:** The bottom pane is NOT mounted yet — that's Task 10. Visual layout is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/deployments.jsx
git commit -m "refactor(deployments): mirror selectedLocation in ?deploymentID URL param"
```

---

## Task 10: New layout — vertical PanelGroup with conditional bottom pane

**Files:**
- Modify: `src/renderer/src/deployments.jsx`

Replace the current "map top / list bottom" vertical split with a vertical group whose children depend on `selectedLocation`. Top pane is always-present and contains a horizontal split of map+list. Bottom pane mounts only when `selectedLocation` is a real deployment.

### Steps

- [ ] **Step 1: Import `DeploymentDetailPane`**

```jsx
import DeploymentDetailPane from './deployments/DeploymentDetailPane'
```

- [ ] **Step 2: Restructure the JSX**

Replace the existing return block of `Deployments` — currently:

```jsx
return (
  <div className={`flex flex-col px-4 h-full overflow-hidden ${isPlaceMode ? 'place-mode-active' : ''}`}>
    <PanelGroup direction="vertical" autoSaveId="deployments-layout">
      <Panel defaultSize={55} minSize={20} className="flex flex-col">
        {deploymentsList && (<LocationMap … />)}
      </Panel>
      <PanelResizeHandle … />
      <Panel defaultSize={45} minSize={20} className="flex flex-col">
        {isActivityLoading ? <SkeletonDeploymentsList … /> : activity ? <LocationsList … /> : null}
      </Panel>
    </PanelGroup>
  </div>
)
```

with:

```jsx
return (
  <div className={`flex flex-col px-4 h-full overflow-hidden ${isPlaceMode ? 'place-mode-active' : ''}`}>
    <PanelGroup direction="vertical" autoSaveId="deployments-v2">
      <Panel defaultSize={selectedLocation ? 38 : 100} minSize={20} className="flex flex-col">
        <PanelGroup direction="horizontal" autoSaveId="deployments-v2-top">
          <Panel defaultSize={38} minSize={20} className="flex flex-col">
            {deploymentsList && (
              <LocationMap
                locations={deploymentsList}
                selectedLocation={selectedLocation}
                setSelectedLocation={setSelectedLocation}
                onNewLatitude={onNewLatitude}
                onNewLongitude={onNewLongitude}
                isPlaceMode={isPlaceMode}
                onPlaceLocation={handlePlaceLocation}
                onExitPlaceMode={handleExitPlaceMode}
                onExpandGroup={handleExpandGroup}
                studyId={studyId}
              />
            )}
          </Panel>
          <PanelResizeHandle className="w-2 mx-1 rounded bg-gray-200 hover:bg-blue-300 data-[resize-handle-state=drag]:bg-blue-400 cursor-col-resize transition-colors" />
          <Panel defaultSize={62} minSize={20} className="flex flex-col">
            {isActivityLoading ? (
              <SkeletonDeploymentsList itemCount={6} />
            ) : activity ? (
              <LocationsList
                activity={activity}
                selectedLocation={selectedLocation}
                setSelectedLocation={setSelectedLocation}
                onNewLatitude={onNewLatitude}
                onNewLongitude={onNewLongitude}
                onEnterPlaceMode={handleEnterPlaceMode}
                onRenameLocation={onRenameLocation}
                isPlaceMode={isPlaceMode}
                groupToExpand={groupToExpand}
                onGroupExpanded={handleGroupExpanded}
                onPeriodCountChange={setPeriodCount}
              />
            ) : null}
          </Panel>
        </PanelGroup>
      </Panel>
      {selectedLocation && (
        <>
          <PanelResizeHandle className="h-2 my-1 rounded bg-gray-200 hover:bg-blue-300 data-[resize-handle-state=drag]:bg-blue-400 cursor-row-resize transition-colors" />
          <Panel defaultSize={62} minSize={20} className="flex flex-col">
            <DeploymentDetailPane
              deployment={selectedLocation}
              onClose={() => setSelectedLocation(null)}
            />
          </Panel>
        </>
      )}
    </PanelGroup>
  </div>
)
```

> **Why `defaultSize={selectedLocation ? 38 : 100}` on the top panel:** when no deployment is selected, only one Panel is rendered inside the vertical group, so it naturally fills 100%. When a deployment is selected, the new defaults (38/62) apply for first-time users; `react-resizable-panels` then persists subsequent user adjustments via `autoSaveId="deployments-v2"`.

- [ ] **Step 3: Lint**

```bash
npm run lint -- --quiet
```

Expected: clean.

- [ ] **Step 4: Manual smoke — both states work**

```bash
npm run dev
```

In the running app, switch to the Deployments tab:
1. **No selection:** map and list sit side by side at ~38/62. No bottom pane visible. Top row fills 100%.
2. **Click a list row:** URL gains `?deploymentID=…`; bottom pane mounts at ~62% height, showing the deployment-scoped media gallery.
3. **Click another row:** bottom pane stays mounted; content swaps; pane height stays where the user dragged it.
4. **Click the ✕:** pane unmounts; URL param cleared; top row fills 100% again.
5. **Drag the horizontal handle (top↔bottom):** ratio updates; reload — ratio persists.
6. **Drag the vertical handle (map↔list):** ratio updates; reload — ratio persists.
7. **Click a multi-deployment group header:** group expands/collapses; bottom pane does NOT open.

If any of those break, debug before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/deployments.jsx
git commit -m "feat(deployments): add inline media workspace for selected deployment"
```

---

## Task 11: Esc key closes the pane

**Files:**
- Modify: `src/renderer/src/deployments.jsx`

The ✕ button (Task 10) and the toggle behavior (clicking the selected row again — implemented next) cover two of the three close affordances. The third is Esc.

There's already an Esc handler inside `LocationMap` for exiting place mode. The new global Esc handler must NOT fight it: only deselect when place mode is OFF.

### Steps

- [ ] **Step 1: Add the Esc handler to `Deployments`**

Inside the `Deployments` component body, before the `return`:

```jsx
useEffect(() => {
  const onKey = (e) => {
    if (e.key === 'Escape' && selectedLocation && !isPlaceMode) {
      setSelectedLocation(null)
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [selectedLocation, isPlaceMode, setSelectedLocation])
```

- [ ] **Step 2: Manual smoke — Esc behavior**

```bash
npm run dev
```

In the running app:
1. Select a deployment → press Esc → pane closes, URL param cleared.
2. Enter place mode (click the pin icon on a deployment row) → press Esc → place mode exits but pane stays open (the existing `LocationMap` Esc handler runs first; selection is preserved).
3. With pane closed, press Esc → no effect.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/deployments.jsx
git commit -m "feat(deployments): Esc closes the media pane (when not in place mode)"
```

---

## Task 12: Toggle-off — clicking the selected row clears selection

**Files:**
- Modify: `src/renderer/src/deployments.jsx`

Per the spec, clicking the already-selected row should deselect (closing the pane). The current `DeploymentRow.onClick` always calls `onSelect(location)`. Wrap that callback so it deselects when the same row is clicked twice.

### Steps

- [ ] **Step 1: Make `setSelectedLocation` toggle-aware**

Replace the `setSelectedLocation` callback inside `Deployments`:

```jsx
const setSelectedLocation = useCallback(
  (location) => {
    const nextID =
      location && location.deploymentID === selectedLocation?.deploymentID
        ? null
        : location?.deploymentID ?? null
    setSearchParams(withDeploymentParam(searchParams, nextID), { replace: true })
  },
  [searchParams, setSearchParams, selectedLocation]
)
```

> **Map marker click semantics:** clicking a marker still calls `setSelectedLocation(location)`. With this toggle, clicking the active marker would deselect — same affordance as the list, which is consistent. If a future change wants the map's behavior to differ, the call site can pass an explicit toggle flag — out of scope here.

- [ ] **Step 2: Manual smoke — toggle behavior**

```bash
npm run dev
```

In the running app:
1. Click row A → pane opens with A.
2. Click row A again → pane closes; URL param cleared.
3. Click row A → pane opens; click row B → pane stays open, content swaps to B; click row B again → pane closes.
4. Click the active map marker → pane closes (toggle-off). Click it again → pane opens.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/deployments.jsx
git commit -m "feat(deployments): clicking the selected row toggles the media pane off"
```

---

## Task 13: Update architecture docs

**Files:**
- Modify: `docs/architecture.md`

### Steps

- [ ] **Step 1: Find the renderer component-tree section**

```bash
grep -n "deployments\|Deployments\|component tree\|renderer/" docs/architecture.md | head -20
```

- [ ] **Step 2: Add the new files to the renderer section**

In the renderer's directory description (or component-tree diagram, whichever the doc currently uses), add:
- `src/renderer/src/deployments/DeploymentDetailPane.jsx` — bottom-pane container in the Deployments tab.
- `src/renderer/src/deployments/urlState.js` — `?deploymentID=…` URL state helpers.
- `src/renderer/src/media/Gallery.jsx` — shared `Gallery` + `ImageModal` (extracted from `media.jsx`; consumed by both Media tab and Deployments tab).
- `src/renderer/src/media/DeploymentMediaGallery.jsx` — deployment-scoped wrapper.

If the doc has a Deployments-tab section, replace its description with the new layout (vertical group with conditional bottom pane; top row is a horizontal map+list split).

Keep edits scoped — don't restructure the doc.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(architecture): note Deployments tab inline media workspace + Gallery extraction"
```

---

## Task 14: End-to-end manual smoke

**Files:** none (verification only).

A final pass after all the code is committed, to catch regressions that didn't surface in the per-task smoke checks.

### Steps

- [ ] **Step 1: Run the full test suite**

```bash
npm run test:rebuild && node --test 'test/**/*.test.js'
```

Expected: same pass count as the baseline measured before Task 1, plus the new tests added in Task 1, Task 2, and Task 8.

- [ ] **Step 2: Run lint**

```bash
npm run lint -- --quiet
```

Expected: clean.

- [ ] **Step 3: Manual smoke — Media tab unchanged**

```bash
npm run dev
```

On a study with media:
1. Open the Media tab. Verify: gallery loads, thumbnail bboxes toggle, image modal opens, bbox editing works, species filter pills work, timeline brushing works, daily-activity radar renders, sequence-gap slider works.

- [ ] **Step 4: Manual smoke — Deployments tab golden path**

On the same study, switch to the Deployments tab:
1. **Layout:** map ~38% wide on the left, list ~62% wide on the right. No bottom pane.
2. **Select a deployment** (click row): bottom pane mounts at ~62% height; URL gains `?deploymentID=…`; gallery loads only that deployment's media; thumbnails open the same modal as the Media tab.
3. **Switch deployment** (click another row): pane stays mounted; content swaps; resizing remembered.
4. **Close (✕):** pane unmounts; URL param cleared.
5. **Close (Esc):** same as ✕.
6. **Close (toggle):** click the selected row → pane closes.
7. **Group header click:** group expands/collapses; pane does NOT open.
8. **Map marker click:** corresponding row selects + pane opens.
9. **Place mode:** click the pin icon → enter place mode → click the map → coords update → exit. Pane and selection survive.
10. **Deep link:** copy the URL while a deployment is selected; reload — same deployment is selected on load; pane mounts.
11. **Resize persistence:** drag both handles; reload — both ratios persist.
12. **Switch study:** open a different study; selection clears (URL param drops); pane closes.

- [ ] **Step 5: Manual smoke — invalid URL**

Manually edit the URL bar to `?deploymentID=does-not-exist` while on the Deployments tab. Expected: pane does NOT mount; no error in console.

- [ ] **Step 6: Manual smoke — empty deployment**

Find or fake a deployment with no media. Select it. Expected: pane mounts; gallery empty state renders; no error.

- [ ] **Step 7: Final commit (only if any fix-ups were needed)**

```bash
git status
# If any drift was patched up during smoke:
git add <files>
git commit -m "fix(deployments): <one-line description>"
```

If everything passed without fix-ups, no commit is needed in this task.

---

## Done

The branch `arthur/deployments-tab-revamp` is ready for review / PR. Open with:

```bash
gh pr create --title "feat(deployments): inline media workspace" \
             --body "Implements docs/specs/2026-05-02-deployments-tab-revamp-design.md per docs/plans/2026-05-02-deployments-tab-revamp.md"
```

(Use `GH_TOKEN=""` prefix per project convention.)
