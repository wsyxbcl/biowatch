# Empty-species observations: redefine "Blank" + add "Vehicle"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop displaying "—" for empty-species observations and stop reporting Blank=0 in studies whose exporter attaches a `blank`/`unclassified`/`unknown` observation row instead of leaving media observation-less. Surface `vehicle`-typed observations as a distinct, filterable pseudo-species.

**Architecture:** Redefine "Blank media" semantically as *"media with no animal/human/vehicle observation"* (covers zero-obs media + media whose only observations have empty `scientificName`). Add a `VEHICLE_SENTINEL` mirroring the existing `BLANK_SENTINEL` so Vehicle can ride the same pseudo-species filtering pipeline already used for Blank. Replace the proxy filter `observationType != 'blank'` (used in 4 query files) with the precise filter `scientificName IS NOT NULL AND scientificName != ''`. Annotation rail labels every empty-species row as either "Blank" or "Vehicle".

**Tech Stack:** Drizzle ORM + better-sqlite3, React renderer, Electron IPC, node:test for unit/integration tests.

**Spec:** `docs/specs/2026-05-04-empty-species-observations-design.md`

---

## File Structure

**Touched files:**

| Path | Responsibility |
|---|---|
| `src/shared/constants.js` | Add `VEHICLE_SENTINEL` |
| `src/renderer/src/utils/speciesUtils.js` | Re-export `VEHICLE_SENTINEL`, add `isVehicle` predicate |
| `src/main/database/queries/species.js` | Redefine `getBlankMediaCount`; add `getVehicleMediaCount`; replace `observationType != 'blank'` with empty-species filter |
| `src/main/database/queries/deployments.js` | `getSpeciesForDeployment` returns `BLANK_SENTINEL` and `VEHICLE_SENTINEL` rows when applicable; add `getBlankMediaCountForDeployment` and `getVehicleMediaCountForDeployment` helpers |
| `src/main/database/queries/sequences.js` | Update blank-detection subquery to new semantics; add `requestingVehicle` branches |
| `src/main/database/queries/best-media.js` | Replace `observationType != 'blank'` with empty-species filter |
| `src/main/database/queries/overview.js` | Replace `observationType != 'blank'` with empty-species filter |
| `src/main/services/export/exporter.js` | Replace `observationType != 'blank'` with empty-species filter |
| `src/main/ipc/species.js` | Add `species:get-vehicle-count` handler |
| `src/preload/index.js` | Expose `getVehicleMediaCount` |
| `src/renderer/src/ui/ObservationRow.jsx` | Display "Blank"/"Vehicle" instead of "—"; extend italic-gray styling |
| `src/renderer/src/ui/speciesDistribution.jsx` | Render `VEHICLE_SENTINEL` row alongside `BLANK_SENTINEL` |
| `src/renderer/src/media.jsx` | Fetch vehicle count, pass to `SpeciesDistribution` |
| `src/renderer/src/deployments/DeploymentDetailPane.jsx` | Render `BLANK_SENTINEL`/`VEHICLE_SENTINEL` rows in `SpeciesFilterButton` |
| `test/main/database/queries/getSpeciesForDeployment.test.js` | Add coverage for blank/vehicle rows |
| `test/main/database/queries/getBlankMediaCount.test.js` (new) | Test the new semantic blank-media query |
| `test/main/database/queries/getVehicleMediaCount.test.js` (new) | Test the new vehicle-media query |
| `docs/database-schema.md` | Document new blank/vehicle semantics |
| `docs/data-formats.md` | Document empty-species row interpretation |
| `docs/ipc-api.md` | Document `species:get-vehicle-count` |

---

## Task Sequencing Rationale

Tasks are ordered so that each commit leaves the app in a working state, and so that the highest-impact bugfix (annotation rail label) lands first as an independent UX win.

1. **Foundation:** sentinel + helper.
2. **Quick win:** annotation rail label fix (no backend dependency).
3. **Backend definition change:** redefine `getBlankMediaCount` (immediately fixes Library tab counts).
4. **New backend capability:** `getVehicleMediaCount` + IPC.
5. **Sequences.js:** blank-detection update + vehicle branch (must land before UI starts requesting Vehicle filtering).
6. **Library UI:** wire vehicle entry into `SpeciesDistribution`.
7. **Deployments UI:** add blank+vehicle entries to popover, render them.
8. **Cleanup:** replace `observationType != 'blank'` filters across 4 query files.
9. **Documentation.**

---

## Task 1: Add `VEHICLE_SENTINEL` constant + utils

**Files:**
- Modify: `src/shared/constants.js`
- Modify: `src/renderer/src/utils/speciesUtils.js`
- Modify: `test/renderer/speciesUtils.test.js`

- [ ] **Step 1: Add a failing test for `isVehicle`**

Append to `test/renderer/speciesUtils.test.js` (after the existing `isBlank` tests):

```js
import { isVehicle, VEHICLE_SENTINEL } from '../../src/renderer/src/utils/speciesUtils.js'

test('isVehicle returns true for the vehicle sentinel', () => {
  assert.equal(isVehicle(VEHICLE_SENTINEL), true)
})

test('isVehicle returns false for a real species name', () => {
  assert.equal(isVehicle('Sus scrofa'), false)
})

test('isVehicle returns false for blank sentinel', () => {
  assert.equal(isVehicle('__blank__f47ac10b-58cc-4372-a567-0e02b2c3d479__'), false)
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- test/renderer/speciesUtils.test.js`
Expected: ImportError or `isVehicle is not a function`.

- [ ] **Step 3: Add the sentinel to `constants.js`**

In `src/shared/constants.js`, after the `BLANK_SENTINEL` declaration:

```js
/**
 * Sentinel value used to represent vehicle observations as a pseudo-species.
 * Vehicle observations always have empty `scientificName` per the Camtrap DP
 * convention; this sentinel lets the UI's species-filter pipeline treat
 * Vehicle as a single filterable bucket alongside Blank.
 */
export const VEHICLE_SENTINEL = '__vehicle__a8c3e9b2-7d4f-4e1a-9b2c-3d4e5f6a7b8c__'
```

- [ ] **Step 4: Re-export and add `isVehicle` in `speciesUtils.js`**

In `src/renderer/src/utils/speciesUtils.js`, change the import and re-export, and add the predicate:

```js
import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../shared/constants.js'

export { BLANK_SENTINEL, VEHICLE_SENTINEL }
```

After the existing `isBlank` definition, add:

```js
/**
 * Check if a species entry represents a vehicle observation.
 * @param {string} scientificName
 * @returns {boolean}
 */
export const isVehicle = (scientificName) => scientificName === VEHICLE_SENTINEL
```

- [ ] **Step 5: Update `sortSpeciesHumansLast` to place Vehicle right above Blank**

The current order is: regular > human/vehicle keyword-matched > non-species labels > blank. The new explicit `VEHICLE_SENTINEL` entry should sort just above the blank sentinel (it represents a real category, not a sort-of-empty bucket). In `sortSpeciesHumansLast`, after the blank check, before the non-species check:

```js
// Vehicle pseudo-species sits just above Blank
const aIsVehicle = isVehicle(a.scientificName)
const bIsVehicle = isVehicle(b.scientificName)
if (aIsVehicle !== bIsVehicle) return aIsVehicle ? 1 : -1
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npm test -- test/renderer/speciesUtils.test.js`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/shared/constants.js src/renderer/src/utils/speciesUtils.js test/renderer/speciesUtils.test.js
git commit -m "feat(constants): add VEHICLE_SENTINEL and isVehicle helper"
```

---

## Task 2: Annotation rail label — replace "—" with "Blank" / "Vehicle"

**Files:**
- Modify: `src/renderer/src/ui/ObservationRow.jsx:59-63, 111-119`

- [ ] **Step 1: Inspect current code**

Read `src/renderer/src/ui/ObservationRow.jsx:59-63` and `:111-119`. Confirm the fallback chain ends with `(observation.observationType === 'blank' ? 'Blank' : '—')` and that the styling on line 113 keys on `observation.observationType === 'blank'`.

- [ ] **Step 2: Replace the fallback label**

Replace lines 59-63:

```jsx
const isPseudoSpecies =
  !observation.scientificName &&
  !observation.commonName

const pseudoLabel =
  observation.observationType === 'vehicle' ? 'Vehicle' : 'Blank'

const displayName =
  resolveCommonName(observation.scientificName) ||
  observation.commonName ||
  observation.scientificName ||
  pseudoLabel
```

This says: if there's no real species name to display, label the row by `observationType` — `Vehicle` for vehicle rows, `Blank` for everything else (`blank`/`unclassified`/`unknown`/null).

- [ ] **Step 3: Extend the italic-gray styling to all pseudo-species rows**

Replace the styling condition on line 113:

```jsx
<span
  className={`text-sm flex-1 min-w-0 truncate ${
    isPseudoSpecies
      ? 'italic text-gray-400'
      : 'text-[#030213] font-medium capitalize'
  }`}
>
  {displayName}
</span>
```

- [ ] **Step 4: Manually verify**

Run: `npm run dev`. Open the GMU8 Leuven study, navigate to a media item that previously showed "—". Confirm it now shows "Blank" (italic gray). Find a media item with a `vehicle` observation. Confirm it shows "Vehicle" (italic gray).

If you can't reproduce visually, fall back to an integration assertion in step 5; otherwise skip step 5.

- [ ] **Step 5: (only if visual verification not possible) Add a render snapshot for ObservationRow**

Skip if Step 4 succeeded. Otherwise, write a minimal React Testing Library test that mounts `ObservationRow` with `{observationType: 'unclassified', scientificName: null}` and asserts the rendered text contains "Blank" but not "—".

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/ui/ObservationRow.jsx
git commit -m "ui: label empty-species observations as Blank/Vehicle instead of —"
```

---

## Task 3: Redefine `getBlankMediaCount` semantically

**Files:**
- Modify: `src/main/database/queries/species.js:71-100`
- Create: `test/main/database/queries/getBlankMediaCount.test.js`

- [ ] **Step 1: Write failing tests for the new semantics**

Create `test/main/database/queries/getBlankMediaCount.test.js`:

```js
/**
 * Tests for getBlankMediaCount — counts media that have no animal, human,
 * or vehicle observation. Covers media with zero observation rows AND
 * media whose only observations are blank/unclassified/unknown-typed.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getBlankMediaCount,
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
    // not available, fine
  }
  testStudyId = `test-blank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-blank-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seedDeploymentAndMedia(manager, mediaCount) {
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
  const mediaRecords = {}
  for (let i = 0; i < mediaCount; i++) {
    mediaRecords[`m${i}`] = {
      mediaID: `m${i}`,
      deploymentID: 'd1',
      timestamp: DateTime.fromISO(`2024-01-01T00:0${i}:00Z`),
      filePath: `/m${i}.jpg`,
      fileName: `m${i}.jpg`,
      fileMediatype: 'image/jpeg'
    }
  }
  await insertMedia(manager, mediaRecords)
}

test('counts media with zero observations', async () => {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await seedDeploymentAndMedia(manager, 3)
  // No observations inserted

  const count = await getBlankMediaCount(testDbPath)
  assert.equal(count, 3)
})

test('counts media whose only observations are blank-typed (no species)', async () => {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await seedDeploymentAndMedia(manager, 2)
  await insertObservations(manager, {
    o1: {
      observationID: 'o1',
      mediaID: 'm0',
      deploymentID: 'd1',
      observationType: 'blank',
      scientificName: null
    },
    o2: {
      observationID: 'o2',
      mediaID: 'm1',
      deploymentID: 'd1',
      observationType: 'unclassified',
      scientificName: null
    }
  })

  const count = await getBlankMediaCount(testDbPath)
  assert.equal(count, 2)
})

test('counts media whose only observations are unknown-typed', async () => {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await seedDeploymentAndMedia(manager, 1)
  await insertObservations(manager, {
    o1: {
      observationID: 'o1',
      mediaID: 'm0',
      deploymentID: 'd1',
      observationType: 'unknown',
      scientificName: null
    }
  })

  const count = await getBlankMediaCount(testDbPath)
  assert.equal(count, 1)
})

test('does NOT count media with an animal observation', async () => {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await seedDeploymentAndMedia(manager, 1)
  await insertObservations(manager, {
    o1: {
      observationID: 'o1',
      mediaID: 'm0',
      deploymentID: 'd1',
      observationType: 'animal',
      scientificName: 'Sus scrofa'
    }
  })

  const count = await getBlankMediaCount(testDbPath)
  assert.equal(count, 0)
})

test('does NOT count media with a vehicle observation', async () => {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await seedDeploymentAndMedia(manager, 1)
  await insertObservations(manager, {
    o1: {
      observationID: 'o1',
      mediaID: 'm0',
      deploymentID: 'd1',
      observationType: 'vehicle',
      scientificName: null
    }
  })

  const count = await getBlankMediaCount(testDbPath)
  assert.equal(count, 0)
})

test('does NOT count media that has both a blank-typed AND an animal observation', async () => {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await seedDeploymentAndMedia(manager, 1)
  await insertObservations(manager, {
    o1: {
      observationID: 'o1',
      mediaID: 'm0',
      deploymentID: 'd1',
      observationType: 'blank',
      scientificName: null
    },
    o2: {
      observationID: 'o2',
      mediaID: 'm0',
      deploymentID: 'd1',
      observationType: 'animal',
      scientificName: 'Sus scrofa'
    }
  })

  const count = await getBlankMediaCount(testDbPath)
  assert.equal(count, 0)
})
```

- [ ] **Step 2: Run tests and confirm all six fail (or partially fail)**

Run: `npm test -- test/main/database/queries/getBlankMediaCount.test.js`
Expected: At least the blank-typed/unclassified/unknown/mixed-with-animal cases fail, because the current implementation only counts zero-obs media.

- [ ] **Step 3: Rewrite `getBlankMediaCount`**

Replace `src/main/database/queries/species.js:71-100` body. Keep the function signature and logging:

```js
export async function getBlankMediaCount(dbPath) {
  const startTime = Date.now()
  log.info(`Querying blank media count from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    // A media is "blank" iff it has no observation that is either a real
    // species (scientificName populated) or a vehicle. Covers:
    //   - media with zero observations
    //   - media whose only observations are blank/unclassified/unknown-typed
    const realObservations = db
      .select({ one: sql`1` })
      .from(observations)
      .where(
        and(
          eq(observations.mediaID, media.mediaID),
          or(
            and(
              isNotNull(observations.scientificName),
              ne(observations.scientificName, '')
            ),
            eq(observations.observationType, 'vehicle')
          )
        )
      )

    const result = await db
      .select({ count: count().as('count') })
      .from(media)
      .where(notExists(realObservations))
      .get()

    const blankCount = result?.count || 0
    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved blank media count: ${blankCount} in ${elapsedTime}ms`)

    return blankCount
  } catch (error) {
    log.error(`Error querying blank media count: ${error.message}`)
    throw error
  }
}
```

Verify the existing `import` block in `species.js` already has `and`, `or`, `eq`, `ne`, `isNotNull`, `notExists`, `count`, `sql` from drizzle. If any are missing, add them.

- [ ] **Step 4: Run the tests and confirm all pass**

Run: `npm test -- test/main/database/queries/getBlankMediaCount.test.js`
Expected: All six tests pass.

- [ ] **Step 5: Run the full test suite to catch regressions**

Run: `npm test`
Expected: All tests pass. If a test that previously expected `getBlankMediaCount` to count zero-obs media only now fails because of the broader semantics, update it to match the new contract.

- [ ] **Step 6: Commit**

```bash
git add src/main/database/queries/species.js test/main/database/queries/getBlankMediaCount.test.js
git commit -m "fix(species): redefine getBlankMediaCount as media without animal/vehicle observations"
```

---

## Task 4: Add `getVehicleMediaCount` query + IPC + preload

**Files:**
- Modify: `src/main/database/queries/species.js` (add export)
- Modify: `src/main/database/index.js` (re-export)
- Modify: `src/main/database/queries/index.js` (re-export)
- Modify: `src/main/ipc/species.js` (add handler)
- Modify: `src/preload/index.js` (expose API)
- Create: `test/main/database/queries/getVehicleMediaCount.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/main/database/queries/getVehicleMediaCount.test.js` modeled on the blank test from Task 3, with these assertions:

```js
test('counts media with at least one vehicle observation', async () => {
  // seed 2 media; m0 has a vehicle obs, m1 has nothing
  // expect count === 1
})

test('counts media that has both a vehicle AND an animal observation', async () => {
  // seed 1 media with both obs types
  // expect count === 1
})

test('does NOT count media with only animal observations', async () => {
  // expect count === 0
})

test('does NOT count media with only blank/unclassified observations', async () => {
  // expect count === 0
})
```

Use the same `seedDeploymentAndMedia` helper structure as Task 3's test (copy-paste — they're separate files and the helper is a few lines).

- [ ] **Step 2: Run tests and confirm they fail with `getVehicleMediaCount is not exported`**

Run: `npm test -- test/main/database/queries/getVehicleMediaCount.test.js`

- [ ] **Step 3: Implement `getVehicleMediaCount`**

In `src/main/database/queries/species.js`, after `getBlankMediaCount`:

```js
/**
 * Get count of media with at least one vehicle observation.
 * @param {string} dbPath
 * @returns {Promise<number>}
 */
export async function getVehicleMediaCount(dbPath) {
  const startTime = Date.now()
  log.info(`Querying vehicle media count from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    const result = await db
      .select({ count: countDistinct(observations.mediaID).as('count') })
      .from(observations)
      .where(eq(observations.observationType, 'vehicle'))
      .get()

    const vehicleCount = result?.count || 0
    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved vehicle media count: ${vehicleCount} in ${elapsedTime}ms`)

    return vehicleCount
  } catch (error) {
    log.error(`Error querying vehicle media count: ${error.message}`)
    throw error
  }
}
```

Add `countDistinct` to the drizzle imports at the top of `species.js` if not present.

- [ ] **Step 4: Re-export from `database/index.js` and `database/queries/index.js`**

Add `getVehicleMediaCount` to the export list in both files (mirror how `getBlankMediaCount` is re-exported).

- [ ] **Step 5: Add IPC handler**

In `src/main/ipc/species.js`, after the existing `species:get-blank-count` handler:

```js
ipcMain.handle('species:get-vehicle-count', async (_, studyId) => {
  try {
    const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
    if (!dbPath || !existsSync(dbPath)) {
      log.warn(`Database not found for study ID: ${studyId}`)
      return { error: 'Database not found for this study' }
    }
    const vehicleCount = await getVehicleMediaCount(dbPath)
    return { data: vehicleCount }
  } catch (error) {
    log.error('Error getting vehicle media count:', error)
    return { error: error.message }
  }
})
```

Add `getVehicleMediaCount` to the imports at the top.

- [ ] **Step 6: Expose in preload**

In `src/preload/index.js`, after the `getBlankMediaCount` definition:

```js
getVehicleMediaCount: async (studyId) => {
  return await electronAPI.ipcRenderer.invoke('species:get-vehicle-count', studyId)
},
```

- [ ] **Step 7: Run tests and confirm pass**

Run: `npm test -- test/main/database/queries/getVehicleMediaCount.test.js && npm test`

- [ ] **Step 8: Commit**

```bash
git add src/main/database/queries/species.js src/main/database/index.js src/main/database/queries/index.js src/main/ipc/species.js src/preload/index.js test/main/database/queries/getVehicleMediaCount.test.js
git commit -m "feat(species): add getVehicleMediaCount query + IPC"
```

---

## Task 5: Update `sequences.js` — new blank semantics + vehicle branch

**Files:**
- Modify: `src/main/database/queries/sequences.js`

This is the most intricate change. The file already has elaborate `requestingBlanks` branching across 3 phases (timestamped, untimestamped, count). We're (a) updating the blank-detection subquery and (b) adding parallel `requestingVehicle` branches.

- [ ] **Step 1: Re-read `sequences.js` end-to-end**

Read all of `src/main/database/queries/sequences.js`. Map every site that uses `BLANK_SENTINEL`, `requestingBlanks`, or `matchingObservations` (the blank-detection subquery). Expect to find branches around lines 65-66, 116-120, 179-187, 295-320, 372-399, 496-497, 533-554.

- [ ] **Step 2: Update the blank-detection subquery**

Find the `matchingObservations` subquery (around line 117). Today it matches *any* observation row. Update it so blank means "no real species AND no vehicle":

```js
// Subquery: returns 1 if the media has any animal/human/vehicle observation
// (i.e. the media is NOT blank under the new semantic definition).
const realObservations = db
  .select({ one: sql`1` })
  .from(observations)
  .where(
    and(
      eq(observations.mediaID, media.mediaID),
      or(
        and(
          isNotNull(observations.scientificName),
          ne(observations.scientificName, '')
        ),
        eq(observations.observationType, 'vehicle')
      )
    )
  )
```

Rename the variable from `matchingObservations` → `realObservations` so subsequent `notExists(realObservations)` reads as "no real observation = blank". Update every callsite in this file.

Repeat the same subquery rewrite at the second occurrence (around line 533).

- [ ] **Step 3: Add `requestingVehicle` parsing alongside `requestingBlanks`**

Around line 65, replace:

```js
const requestingBlanks = species.includes(BLANK_SENTINEL)
const regularSpecies = species.filter((s) => s !== BLANK_SENTINEL)
```

with:

```js
const requestingBlanks = species.includes(BLANK_SENTINEL)
const requestingVehicle = species.includes(VEHICLE_SENTINEL)
const regularSpecies = species.filter(
  (s) => s !== BLANK_SENTINEL && s !== VEHICLE_SENTINEL
)
```

Add `import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../shared/constants.js'` at the top.

Repeat at the second `requestingBlanks` declaration (around line 496-497).

- [ ] **Step 4: Add a vehicle-detection subquery**

Define a sibling to `realObservations`:

```js
const vehicleObservations = db
  .select({ one: sql`1` })
  .from(observations)
  .where(
    and(
      eq(observations.mediaID, media.mediaID),
      eq(observations.observationType, 'vehicle')
    )
  )
```

- [ ] **Step 5: Extend each blank-handling branch to also handle vehicle**

For each existing branch like:

```js
} else if (requestingBlanks && regularSpecies.length === 0) {
  // Only blanks
  timestampedMedia = await db
    .selectDistinct(selectFields)
    .from(media)
    .where(and(...timestampedConditions, notExists(realObservations)))
    ...
}
```

Add a parallel vehicle branch immediately after, plus update mixed branches to OR-together the conditions:

```js
} else if (!requestingBlanks && requestingVehicle && regularSpecies.length === 0) {
  // Only vehicle
  timestampedMedia = await db
    .selectDistinct(selectFields)
    .from(media)
    .where(and(...timestampedConditions, exists(vehicleObservations)))
    .orderBy(sql`${media.timestamp} DESC, ${media.mediaID} DESC`)
    .limit(batchSize)
} else if (requestingBlanks && requestingVehicle && regularSpecies.length === 0) {
  // Blank + vehicle (no species)
  timestampedMedia = await db
    .selectDistinct(selectFields)
    .from(media)
    .where(
      and(
        ...timestampedConditions,
        or(notExists(realObservations), exists(vehicleObservations))
      )
    )
    .orderBy(sql`${media.timestamp} DESC, ${media.mediaID} DESC`)
    .limit(batchSize)
}
```

For the existing "Mixed: species + blanks" branch (around line 187-207), replicate with vehicle and with blank+vehicle:

```js
} else if (requestingVehicle && regularSpecies.length > 0 && !requestingBlanks) {
  // Mixed: species + vehicle
  const speciesQuery = /* existing speciesQuery construction */
  const vehicleQuery = db
    .selectDistinct(selectFields)
    .from(media)
    .where(and(...timestampedConditions, exists(vehicleObservations)))
  timestampedMedia = await union(speciesQuery, vehicleQuery)
    .orderBy(sql`timestamp DESC, mediaID DESC`)
    .limit(batchSize)
} else if (requestingBlanks && requestingVehicle && regularSpecies.length > 0) {
  // Mixed: species + blanks + vehicle
  const speciesQuery = /* existing speciesQuery construction */
  const blankQuery = db
    .selectDistinct(selectFields)
    .from(media)
    .where(and(...timestampedConditions, notExists(realObservations)))
  const vehicleQuery = db
    .selectDistinct(selectFields)
    .from(media)
    .where(and(...timestampedConditions, exists(vehicleObservations)))
  timestampedMedia = await union(speciesQuery, blankQuery, vehicleQuery)
    .orderBy(sql`timestamp DESC, mediaID DESC`)
    .limit(batchSize)
}
```

Apply the same pattern to:
- The untimestamped phase (around line 372-399)
- The count phase (around line 295-320)
- The second `requestingBlanks` block (around line 547-558)

- [ ] **Step 6: Add `exists` to drizzle imports**

If not already imported in `sequences.js`, add `exists` alongside the existing `notExists` import.

- [ ] **Step 7: Add a regression test**

Create `test/main/database/queries/sequencesVehicleFilter.test.js`. Mirror the structure of `test/main/database/queries/sequencesDeploymentFilter.test.js`. Seed media with a vehicle obs, an animal obs, and a blank-only media. Assert that:

```js
test('VEHICLE_SENTINEL alone returns only vehicle media', async () => {
  // species = [VEHICLE_SENTINEL]
  // expect: only the media with vehicle obs
})

test('VEHICLE_SENTINEL + species returns the union', async () => {
  // species = [VEHICLE_SENTINEL, 'Sus scrofa']
  // expect: vehicle media + Sus scrofa media
})

test('BLANK_SENTINEL + VEHICLE_SENTINEL returns blank media + vehicle media', async () => {
  // species = [BLANK_SENTINEL, VEHICLE_SENTINEL]
  // expect: union
})

test('BLANK_SENTINEL alone no longer returns vehicle media', async () => {
  // species = [BLANK_SENTINEL]
  // seed vehicle media + truly-blank media
  // expect: only the truly-blank media
})
```

- [ ] **Step 8: Run sequence tests + full suite**

Run: `npm test -- test/main/database/queries/`
Expected: All pass, including the new vehicle test and existing `sequencesDeploymentFilter.test.js`.

- [ ] **Step 9: Commit**

```bash
git add src/main/database/queries/sequences.js test/main/database/queries/sequencesVehicleFilter.test.js
git commit -m "feat(sequences): add VEHICLE_SENTINEL branches; redefine blank as no real species"
```

---

## Task 6: Update `getSpeciesForDeployment` to append blank + vehicle entries

**Files:**
- Modify: `src/main/database/queries/deployments.js:125-150`
- Modify: `test/main/database/queries/getSpeciesForDeployment.test.js`

- [ ] **Step 1: Add failing tests**

In `test/main/database/queries/getSpeciesForDeployment.test.js`, add three tests:

```js
import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../../src/shared/constants.js'

test('appends BLANK_SENTINEL row when deployment has blank media', async () => {
  // seed deployment d1 with: 2 media with animal obs, 3 media with only blank-typed obs
  const result = await getSpeciesForDeployment(testDbPath, 'd1')
  const blankRow = result.find((r) => r.scientificName === BLANK_SENTINEL)
  assert.equal(blankRow.count, 3)
})

test('appends VEHICLE_SENTINEL row when deployment has vehicle media', async () => {
  // seed: 2 animal media, 1 vehicle media
  const result = await getSpeciesForDeployment(testDbPath, 'd1')
  const vehicleRow = result.find((r) => r.scientificName === VEHICLE_SENTINEL)
  assert.equal(vehicleRow.count, 1)
})

test('does NOT append blank/vehicle rows when their counts are zero', async () => {
  // seed: only animal media
  const result = await getSpeciesForDeployment(testDbPath, 'd1')
  assert.equal(result.find((r) => r.scientificName === BLANK_SENTINEL), undefined)
  assert.equal(result.find((r) => r.scientificName === VEHICLE_SENTINEL), undefined)
})
```

- [ ] **Step 2: Run and confirm fail**

Run: `npm test -- test/main/database/queries/getSpeciesForDeployment.test.js`

- [ ] **Step 3: Implement deployment-scoped helpers**

In `src/main/database/queries/deployments.js`, after `getSpeciesForDeployment`:

```js
/**
 * Count blank media at a single deployment, using the new "blank media"
 * definition (no animal/human/vehicle observation).
 */
export async function getBlankMediaCountForDeployment(dbPath, deploymentID) {
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

  const realObservations = db
    .select({ one: sql`1` })
    .from(observations)
    .where(
      and(
        eq(observations.mediaID, media.mediaID),
        or(
          and(
            isNotNull(observations.scientificName),
            ne(observations.scientificName, '')
          ),
          eq(observations.observationType, 'vehicle')
        )
      )
    )

  const result = await db
    .select({ count: count().as('count') })
    .from(media)
    .where(and(eq(media.deploymentID, deploymentID), notExists(realObservations)))
    .get()

  return Number(result?.count || 0)
}

/**
 * Count media with at least one vehicle observation at a single deployment.
 */
export async function getVehicleMediaCountForDeployment(dbPath, deploymentID) {
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

  const result = await db
    .select({ count: countDistinct(observations.mediaID).as('count') })
    .from(observations)
    .innerJoin(media, eq(observations.mediaID, media.mediaID))
    .where(
      and(
        eq(media.deploymentID, deploymentID),
        eq(observations.observationType, 'vehicle')
      )
    )
    .get()

  return Number(result?.count || 0)
}
```

Add the necessary drizzle imports (`and`, `or`, `eq`, `ne`, `isNotNull`, `notExists`, `count`, `countDistinct`, `media`) — match the patterns already used in this file.

- [ ] **Step 4: Update `getSpeciesForDeployment` to append sentinel rows**

Modify the function body:

```js
export async function getSpeciesForDeployment(dbPath, deploymentID) {
  const startTime = Date.now()
  try {
    // ... existing species query unchanged ...

    const speciesRows = rows.map((r) => ({
      scientificName: r.scientificName,
      count: Number(r.count)
    }))

    const [blankCount, vehicleCount] = await Promise.all([
      getBlankMediaCountForDeployment(dbPath, deploymentID),
      getVehicleMediaCountForDeployment(dbPath, deploymentID)
    ])

    const result = [...speciesRows]
    if (blankCount > 0) {
      result.push({ scientificName: BLANK_SENTINEL, count: blankCount })
    }
    if (vehicleCount > 0) {
      result.push({ scientificName: VEHICLE_SENTINEL, count: vehicleCount })
    }

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved ${result.length} species for deployment ${deploymentID} in ${elapsedTime}ms`)
    return result
  } catch (error) {
    log.error(`Error querying species for deployment: ${error.message}`)
    throw error
  }
}
```

Add `import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../shared/constants.js'` to the file.

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm test -- test/main/database/queries/getSpeciesForDeployment.test.js && npm test`

- [ ] **Step 6: Commit**

```bash
git add src/main/database/queries/deployments.js test/main/database/queries/getSpeciesForDeployment.test.js
git commit -m "feat(deployments): include Blank and Vehicle entries in species filter"
```

---

## Task 7: Render Vehicle entry in `SpeciesDistribution` (Library tab)

**Files:**
- Modify: `src/renderer/src/ui/speciesDistribution.jsx`
- Modify: `src/renderer/src/media.jsx`

- [ ] **Step 1: Read the existing blank wiring**

Read `src/renderer/src/media.jsx:59-72` and `src/renderer/src/ui/speciesDistribution.jsx` (full file). Confirm the pattern:
- `media.jsx` does `useQuery({ queryKey: ['blankMediaCount', actualStudyId], ...})` and passes `blankCount={blankCount}` to `<SpeciesDistribution>`.
- `speciesDistribution.jsx` appends a `BLANK_SENTINEL` entry when `blankCount > 0`.

- [ ] **Step 2: Add a `vehicleMediaCount` query in `media.jsx`**

After the existing `blankMediaCount` `useQuery`:

```jsx
const { data: vehicleCount = 0 } = useQuery({
  queryKey: ['vehicleMediaCount', actualStudyId],
  queryFn: async () => {
    const response = await window.api.getVehicleMediaCount(actualStudyId)
    if (response.error) throw new Error(response.error)
    return response.data
  },
  enabled: !!actualStudyId
})
```

Pass `vehicleCount={vehicleCount}` to the `<SpeciesDistribution>` component (around line 251).

- [ ] **Step 3: Accept `vehicleCount` and append the entry**

In `src/renderer/src/ui/speciesDistribution.jsx`, change the `SpeciesDistribution` signature (around line 113):

```jsx
function SpeciesDistribution({
  data,
  taxonomicData,
  selectedSpecies,
  onSpeciesChange,
  palette,
  blankCount = 0,
  vehicleCount = 0,
  studyId = null
}) {
```

Update the `displayData` memo (around line 122):

```jsx
const displayData = useMemo(() => {
  let result = data
  if (vehicleCount > 0) {
    result = [...result, { scientificName: VEHICLE_SENTINEL, count: vehicleCount }]
  }
  if (blankCount > 0) {
    result = [...result, { scientificName: BLANK_SENTINEL, count: blankCount }]
  }
  return result
}, [data, blankCount, vehicleCount])
```

Add `VEHICLE_SENTINEL` and `isVehicle` to the existing imports from `../utils/speciesUtils`.

- [ ] **Step 4: Update the row renderer to label Vehicle**

Find the row component (around line 28-30) that uses `isBlankEntry`. Mirror the same pattern for vehicle:

```jsx
const isVehicleEntry = isVehicle(species.scientificName)
const isPseudoSpeciesEntry = isBlankEntry || isVehicleEntry

// Hook must be called unconditionally
const resolved = useCommonName(
  isPseudoSpeciesEntry ? null : species.scientificName,
  { storedCommonName }
)
const displayName = isBlankEntry
  ? 'Blank'
  : isVehicleEntry
    ? 'Vehicle'
    : resolved || species.scientificName
```

Apply the same `isPseudoSpeciesEntry` styling switch (italic gray) wherever `isBlankEntry` was previously checked for visual treatment. Pass it down to the row component prop list.

- [ ] **Step 5: Update `speciesCount` calculation**

The line `const speciesCount = blankCount > 0 ? displayData.length - 1 : displayData.length` (around line 197) needs to also subtract for vehicle:

```jsx
const pseudoSpeciesCount = (blankCount > 0 ? 1 : 0) + (vehicleCount > 0 ? 1 : 0)
const speciesCount = displayData.length - pseudoSpeciesCount
```

- [ ] **Step 6: Manually verify**

Run: `npm run dev`. Open GMU8 Leuven. Confirm the Library-tab species filter now shows Blank (~470K) and Vehicle (~6,579) entries. Click Vehicle → gallery filters to vehicle media. Click Blank → gallery filters to truly-blank media (NOT vehicle).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/ui/speciesDistribution.jsx src/renderer/src/media.jsx
git commit -m "feat(library): show Vehicle entry alongside Blank in species filter"
```

---

## Task 8: Render Blank + Vehicle entries in Deployments species-filter popover

**Files:**
- Modify: `src/renderer/src/deployments/DeploymentDetailPane.jsx`

- [ ] **Step 1: Read the popover code**

Read `src/renderer/src/deployments/DeploymentDetailPane.jsx:60-230`. Confirm: `SpeciesFilterButton` queries `['deploymentSpecies', studyId, deploymentID]` → `getDeploymentSpecies` IPC, and renders each row via `SpeciesFilterRow`. After Task 6, that array will already include `BLANK_SENTINEL` and `VEHICLE_SENTINEL` rows when applicable.

- [ ] **Step 2: Update `SpeciesFilterRow` to render sentinel rows specially**

Find `SpeciesFilterRow` (around line 172). Currently it renders `scientificName` directly. Change it to detect the sentinels and label/style accordingly:

```jsx
import { isBlank, isVehicle } from '../utils/speciesUtils'

function SpeciesFilterRow({ studyId, scientificName, count, isSelected, onToggle, scrollSignal }) {
  const isBlankEntry = isBlank(scientificName)
  const isVehicleEntry = isVehicle(scientificName)
  const isPseudo = isBlankEntry || isVehicleEntry

  const label = isBlankEntry
    ? 'Blank'
    : isVehicleEntry
      ? 'Vehicle'
      : scientificName

  // ... rest of component, with:
  //   - className adds 'italic text-gray-500' when isPseudo
  //   - the SpeciesTooltipContent hover card is suppressed when isPseudo
  //     (no GBIF lookup possible)
}
```

Find the existing `<HoverCard>` wrapping the row content (around line 217-225) and wrap it in a conditional: `{isPseudo ? rowContent : <HoverCard>...{rowContent}...</HoverCard>}`.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`. Open GMU8 Leuven, open the Deployments tab, click a deployment that has blank or vehicle media, click the species-filter icon. Confirm the popover shows "Blank" and "Vehicle" entries with counts. Selecting them filters the gallery correctly.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/deployments/DeploymentDetailPane.jsx
git commit -m "feat(deployments): render Blank/Vehicle pseudo-species in filter popover"
```

---

## Task 9: Replace `observationType != 'blank'` filters with empty-species filter

**Files:**
- Modify: `src/main/database/queries/best-media.js`
- Modify: `src/main/database/queries/overview.js`
- Modify: `src/main/database/queries/species.js`
- Modify: `src/main/services/export/exporter.js`

The current filter `(observationType IS NULL OR observationType != 'blank')` is a proxy for "has a real species name". It accidentally lets `unclassified`/`unknown`/`vehicle`-typed empty-species rows through, polluting species distributions in studies like GMU8 Leuven. Replace with the precise filter.

- [ ] **Step 1: Audit every callsite**

Run: `grep -rn "observationType.*!=.*'blank'\|observationType.*!==.*'blank'" src/main/`
Confirm the four files listed above contain all matches. There should be ~10-12 occurrences total.

- [ ] **Step 2: Replace each occurrence**

For each `(observationType IS NULL OR observationType != 'blank')` (raw SQL) replace with:
```sql
(scientificName IS NOT NULL AND scientificName != '')
```

For each Drizzle expression like:
```js
or(isNull(observations.observationType), ne(observations.observationType, 'blank'))
```
replace with:
```js
and(isNotNull(observations.scientificName), ne(observations.scientificName, ''))
```

Add the comment above each replaced site:
```
// Filter to observations that name an actual species. Excludes blank/
// unclassified/unknown/vehicle empty-species rows. See spec
// docs/specs/2026-05-04-empty-species-observations-design.md.
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: All tests pass. The semantic difference is a no-op on data that obeys the convention (`blank`-typed = empty scientificName), so existing fixtures should still pass.

- [ ] **Step 4: Manually verify Overview tab**

Run: `npm run dev`. Open GMU8 Leuven → Overview tab. Confirm species count, threatened count, and species distribution chart all look reasonable (no phantom "" species, totals roughly match Library tab counts).

- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/best-media.js src/main/database/queries/overview.js src/main/database/queries/species.js src/main/services/export/exporter.js
git commit -m "refactor(queries): filter on scientificName instead of observationType for species queries"
```

---

## Task 10: Documentation updates

**Files:**
- Modify: `docs/database-schema.md`
- Modify: `docs/data-formats.md`
- Modify: `docs/ipc-api.md`

- [ ] **Step 1: Update `docs/database-schema.md`**

Add a "Pseudo-species and blank media" subsection documenting:
- Camtrap DP `observationType` enum and which values carry a species name vs not
- The semantic definition of "blank media" used by `getBlankMediaCount`: media with no animal/human/vehicle observation
- The semantic definition of "vehicle media": media with at least one `observationType='vehicle'` observation
- Note that `BLANK_SENTINEL` and `VEHICLE_SENTINEL` (defined in `src/shared/constants.js`) are used in the species-filter pipeline to request these media buckets

- [ ] **Step 2: Update `docs/data-formats.md`**

Add a section documenting how empty-species observation rows are interpreted on import (the camtrapDP parser preserves them verbatim) and surfaced in the UI (annotation rail labels them; species filters expose Blank and Vehicle buckets).

- [ ] **Step 3: Update `docs/ipc-api.md`**

Add the `species:get-vehicle-count` handler entry, mirroring the `species:get-blank-count` documentation.

- [ ] **Step 4: Commit**

```bash
git add docs/database-schema.md docs/data-formats.md docs/ipc-api.md
git commit -m "docs: document blank/vehicle pseudo-species semantics"
```

---

## Final verification

- [ ] **Run the full test suite**: `npm test` — expect all tests to pass.
- [ ] **Lint/typecheck if configured**: check `package.json` for `lint`, `typecheck`, or `format` scripts and run them.
- [ ] **Manual smoke test on GMU8 Leuven**:
  1. Open GMU8 Leuven study.
  2. Library tab: confirm Blank count is non-zero (~470K), Vehicle entry shows ~6,579.
  3. Click Blank → gallery filters; rail shows "Blank" labels (no "—").
  4. Click Vehicle → gallery filters; rail shows "Vehicle" labels.
  5. Deployments tab: open a deployment with blank/vehicle media → confirm filter popover shows Blank and Vehicle entries with counts; selecting filters correctly.
  6. Overview tab: counts and species distribution look sane.
- [ ] **Manual smoke test on a clean study (e.g., `e5a77c17` or `1378cb43`)** to confirm no regression on image-only or all-animal studies.
