# Undo/Redo for Annotation Edits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/specs/2026-05-05-undo-redo-annotations-design.md`

**Goal:** Add a study-session-wide undo/redo stack covering the four observation-mutation IPCs (create, delete, update-bbox, update-classification), with auto-navigation to the affected image, keyboard shortcuts (`Cmd+Z` / `Cmd+Shift+Z`), bounded memory (100 entries), and a subtle bbox pulse for visual feedback.

**Architecture:** Command-pattern `UndoManager` singleton (one per loaded study) exposed via React Context. The four mutation call sites in `Gallery.jsx` route their writes through `undoManager.exec(command)` instead of calling the IPC directly. Each command captures the affected observation's pre-state from the React Query cache, runs the existing forward IPC, and pushes a stack entry containing the data needed to dispatch a stamp-free `restoreObservation` IPC for inverse and redo. `createObservation` is extended to accept optional `observationID` and `eventID` so undo-of-delete recreates the observation with its original UUID — validated on real biowatch study DBs.

**Tech Stack:** Electron + React, React Query, drizzle-orm + better-sqlite3, `node:test` for unit/integration tests, vanilla CSS for the pulse animation.

**Branch:** `arthur/feat-undo-stack-editing`

---

## File Structure

**New** (renderer state machinery):
- `src/renderer/src/undo/UndoManager.js` — class with `undoStack`, `redoStack`, `exec()`, `undo()`, `redo()`, `clear()`, pulse-event emitter. ~120 lines.
- `src/renderer/src/undo/commands.js` — pure builders `commands.create()`, `commands.delete()`, `commands.updateBbox()`, `commands.updateClassification()` — each returns `{ entry, forward, inverse, redo }`. ~150 lines.
- `src/renderer/src/undo/context.jsx` — `UndoProvider` + `useUndo` hook. ~40 lines.

**New** (tests):
- `test/renderer/undo/UndoManager.test.js` — stack semantics, cap, redo clearing, failure handling, pulse events. Pure logic, mocks for IPC + navigation.
- `test/renderer/undo/commands.test.js` — entry shape per type, inverse/redo correctness.
- `test/main/database/createObservationExplicitIds.test.js` — `createObservation` accepts optional `observationID` and `eventID`; rejects duplicates.
- `test/main/database/restoreObservation.test.js` — `restoreObservation` updates fields without auto-stamping; throws on 0 rows.

**Modified** (backend):
- `src/main/database/queries/observations.js` — extend `createObservation` (3 lines); add `restoreObservation` (~30 lines).
- `src/main/database/queries/index.js` — export `restoreObservation`.
- `src/main/database/index.js` — re-export `restoreObservation`.
- `src/main/ipc/observations.js` — register `observations:restore` IPC handler.
- `src/preload/index.js` — bridge `restoreObservation`.

**Modified** (renderer integration):
- `src/renderer/src/media/Gallery.jsx` — mount `UndoProvider`, route the four mutations through `undo.exec(...)`, bind keyboard shortcuts, add auto-navigation effect.
- `src/renderer/src/ui/EditableBbox.jsx` — listen for pulse events, toggle `bbox--pulse` class.
- `src/renderer/src/assets/main.css` (or wherever bbox styles live) — `.bbox--pulse` keyframe animation.

**Modified** (docs):
- `docs/architecture.md` — note the new `undo/` module.
- `docs/ipc-api.md` — document `observations:restore`; note extended `observations:create` payload.
- `docs/database-schema.md` — note that `observationID` reuse-after-delete is supported and relied on by undo.

---

## Task 1 — Extend `createObservation` to accept optional `observationID` + `eventID`

**Why:** Undo-of-delete must recreate an observation with the same UUID so any earlier stack entries that reference it remain valid. Validated on live study DB: `INSERT` with the same `observationID` after a `DELETE` round-trips cleanly; PK uniqueness still enforced.

**Files:**
- Modify: `src/main/database/queries/observations.js:260-364` (the `createObservation` function — change ~3 lines)
- Test: `test/main/database/createObservationExplicitIds.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `test/main/database/createObservationExplicitIds.test.js`:

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  createObservation
} from '../../../src/main/database/index.js'

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    /* ok */
  }

  testStudyId = `test-create-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-create-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seedDeploymentAndMedia() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1',
      locationID: 'loc1',
      locationName: 'Test',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
      latitude: 0,
      longitude: 0
    }
  })
  await insertMedia(manager, {
    'img.jpg': {
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-01-01T00:00:00Z'),
      filePath: '/fake/img.jpg',
      fileName: 'img.jpg'
    }
  })
}

describe('createObservation with explicit IDs', () => {
  test('uses provided observationID and eventID instead of generating new ones', async () => {
    await seedDeploymentAndMedia()

    const created = await createObservation(testDbPath, {
      observationID: 'fixed-obs-uuid',
      eventID: 'fixed-event-uuid',
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: '2024-01-01T00:00:00.000Z',
      scientificName: 'capreolus capreolus',
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2
    })

    assert.equal(created.observationID, 'fixed-obs-uuid')
    assert.equal(created.eventID, 'fixed-event-uuid')
  })

  test('still generates UUIDs when IDs are not provided', async () => {
    await seedDeploymentAndMedia()

    const created = await createObservation(testDbPath, {
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: '2024-01-01T00:00:00.000Z',
      scientificName: 'capreolus capreolus',
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2
    })

    assert.match(created.observationID, /^[0-9a-f-]{36}$/)
    assert.match(created.eventID, /^[0-9a-f-]{36}$/)
  })

  test('rejects a second insert with the same observationID', async () => {
    await seedDeploymentAndMedia()

    await createObservation(testDbPath, {
      observationID: 'duplicate-uuid',
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: '2024-01-01T00:00:00.000Z',
      scientificName: 'capreolus capreolus',
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2
    })

    await assert.rejects(
      () =>
        createObservation(testDbPath, {
          observationID: 'duplicate-uuid',
          mediaID: 'm1',
          deploymentID: 'd1',
          timestamp: '2024-01-01T00:00:00.000Z',
          scientificName: 'lepus europaeus',
          bboxX: 0.3,
          bboxY: 0.3,
          bboxWidth: 0.2,
          bboxHeight: 0.2
        }),
      /UNIQUE/
    )
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```
npm test -- --test-name-pattern="createObservation with explicit IDs"
```

Expected: first test fails — `created.observationID` is a fresh UUID, not `'fixed-obs-uuid'`.

- [ ] **Step 3: Modify `createObservation`**

In `src/main/database/queries/observations.js` around line 314, replace:

```js
    // Generate IDs
    const observationID = crypto.randomUUID()
    const eventID = crypto.randomUUID()
```

with:

```js
    // Generate IDs (or accept explicit ones — used by the undo system to
    // recreate a previously deleted observation with its original UUID).
    const observationID = observationData.observationID ?? crypto.randomUUID()
    const eventID = observationData.eventID ?? crypto.randomUUID()
```

Also extend the JSDoc above the function — add to the `observationData` param block:

```
 * @param {string} [observationData.observationID] - Optional explicit ID (used by undo to recreate deleted observations)
 * @param {string} [observationData.eventID] - Optional explicit event ID (preserved alongside observationID)
```

- [ ] **Step 4: Run tests, expect pass**

```
npm test -- --test-name-pattern="createObservation with explicit IDs"
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```
git add src/main/database/queries/observations.js test/main/database/createObservationExplicitIds.test.js
git commit -m "feat(observations): accept optional observationID and eventID in createObservation"
```

---

## Task 2 — Add `restoreObservation` query function

**Why:** Undo of bbox / classification edits must restore the *exact* prior state — including `classificationMethod`, `classifiedBy`, `classificationTimestamp` — without the existing IPCs' "user just edited" auto-stamping. This is a separate code path because the existing IPCs are correct for direct user edits but wrong for time-reversal.

**Files:**
- Modify: `src/main/database/queries/observations.js` (add new function below `deleteObservation`)
- Modify: `src/main/database/queries/index.js` (export the new function)
- Test: `test/main/database/restoreObservation.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `test/main/database/restoreObservation.test.js`:

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations,
  restoreObservation
} from '../../../src/main/database/index.js'

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    /* ok */
  }
  testStudyId = `test-restore-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-restore-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seedObservation(overrides = {}) {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1',
      locationID: 'loc1',
      locationName: 'Test',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
      latitude: 0,
      longitude: 0
    }
  })
  await insertMedia(manager, {
    'img.jpg': {
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-01-01T00:00:00Z'),
      filePath: '/fake/img.jpg',
      fileName: 'img.jpg'
    }
  })
  await insertObservations(manager, [
    {
      observationID: 'obs1',
      mediaID: 'm1',
      deploymentID: 'd1',
      eventID: 'e1',
      eventStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      eventEnd: DateTime.fromISO('2024-01-01T00:00:00Z'),
      scientificName: 'capreolus capreolus',
      observationType: 'animal',
      classificationProbability: 0.95,
      count: 1,
      ...overrides
    }
  ])
}

describe('restoreObservation', () => {
  test('updates fields without overwriting classificationMethod / classifiedBy / classificationTimestamp', async () => {
    await seedObservation()

    const restored = await restoreObservation(testDbPath, 'obs1', {
      bboxX: 0.5,
      bboxY: 0.5,
      bboxWidth: 0.1,
      bboxHeight: 0.1,
      classificationMethod: 'machine',
      classifiedBy: 'SpeciesNet 4.0.1a',
      classificationTimestamp: '2023-12-01T00:00:00.000Z',
      classificationProbability: 0.95
    })

    assert.equal(restored.bboxX, 0.5)
    assert.equal(restored.classificationMethod, 'machine')
    assert.equal(restored.classifiedBy, 'SpeciesNet 4.0.1a')
    assert.equal(restored.classificationTimestamp, '2023-12-01T00:00:00.000Z')
    assert.equal(restored.classificationProbability, 0.95)
  })

  test('only updates the fields provided — leaves others untouched', async () => {
    await seedObservation({ scientificName: 'lepus europaeus' })

    const restored = await restoreObservation(testDbPath, 'obs1', {
      bboxX: 0.3,
      bboxY: 0.3,
      bboxWidth: 0.2,
      bboxHeight: 0.2
    })

    assert.equal(restored.scientificName, 'lepus europaeus')
    assert.equal(restored.bboxX, 0.3)
  })

  test('throws when no observation matches the id (0 rows affected)', async () => {
    await seedObservation()

    await assert.rejects(
      () => restoreObservation(testDbPath, 'no-such-obs', { bboxX: 0.1 }),
      /not found|0 rows/i
    )
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```
npm test -- --test-name-pattern="restoreObservation"
```

Expected: import fails — `restoreObservation` isn't exported.

- [ ] **Step 3: Add `restoreObservation` in `observations.js`**

Append to `src/main/database/queries/observations.js` (after `deleteObservation`):

```js
/**
 * Restore an observation's fields to a prior state (used by the undo system).
 * Unlike updateObservationClassification / updateObservationBbox, this does NOT
 * auto-stamp classificationMethod / classifiedBy / classificationTimestamp —
 * undo is "revert state", not "another user edit", so it must preserve whatever
 * those fields were at the snapshot point.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} observationID - The observation ID to restore
 * @param {Object} fields - Fields to overwrite verbatim. Any combination of:
 *   bboxX, bboxY, bboxWidth, bboxHeight, scientificName, commonName,
 *   observationType, sex, lifeStage, behavior, classificationMethod,
 *   classifiedBy, classificationTimestamp, classificationProbability
 * @returns {Promise<Object>} - The restored observation
 * @throws if no row matches observationID (so external deletions trigger the
 *         caller's failure path rather than silently doing nothing).
 */
export async function restoreObservation(dbPath, observationID, fields) {
  const startTime = Date.now()
  log.info(`Restoring observation: ${observationID}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    const result = await db
      .update(observations)
      .set(fields)
      .where(eq(observations.observationID, observationID))

    const rowsAffected = result.changes ?? result.rowsAffected ?? 0
    if (rowsAffected === 0) {
      throw new Error(`Observation not found: ${observationID}`)
    }

    const restored = await db
      .select()
      .from(observations)
      .where(eq(observations.observationID, observationID))
      .get()

    const elapsedTime = Date.now() - startTime
    log.info(`Restored observation ${observationID} in ${elapsedTime}ms`)
    return restored
  } catch (error) {
    log.error(`Error restoring observation: ${error.message}`)
    throw error
  }
}
```

- [ ] **Step 4: Export from `queries/index.js` and `database/index.js`**

In `src/main/database/queries/index.js`, add `restoreObservation` to the export list from `./observations.js`. (Inspect the file to match its existing pattern — typically `export { ..., restoreObservation } from './observations.js'`.)

In `src/main/database/index.js`, ensure `restoreObservation` is re-exported alongside the other observation queries.

- [ ] **Step 5: Run tests, expect pass**

```
npm test -- --test-name-pattern="restoreObservation"
```

Expected: 3 passing.

- [ ] **Step 6: Commit**

```
git add src/main/database/queries/observations.js src/main/database/queries/index.js src/main/database/index.js test/main/database/restoreObservation.test.js
git commit -m "feat(observations): add restoreObservation query for undo path"
```

---

## Task 3 — Wire `restoreObservation` through IPC and preload

**Files:**
- Modify: `src/main/ipc/observations.js` (register handler)
- Modify: `src/preload/index.js` (bridge function)

- [ ] **Step 1: Register the IPC handler**

In `src/main/ipc/observations.js`, add `restoreObservation` to the import on line 10-14:

```js
import {
  updateObservationClassification,
  updateObservationBbox,
  deleteObservation,
  createObservation,
  restoreObservation
} from '../database/index.js'
```

Append a new handler inside `registerObservationsIPCHandlers()` (after the create handler):

```js
  // Restore observation fields to a prior state (used by undo)
  ipcMain.handle('observations:restore', async (_, studyId, observationID, fields) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const restored = await restoreObservation(dbPath, observationID, fields)
      return { data: restored }
    } catch (error) {
      log.error('Error restoring observation:', error)
      return { error: error.message }
    }
  })
```

- [ ] **Step 2: Bridge it in preload**

In `src/preload/index.js` after the existing `createObservation` bridge (around line 318-321):

```js
  // Restore observation to a prior state (used by undo, no auto-stamping)
  restoreObservation: async (studyId, observationID, fields) => {
    return await electronAPI.ipcRenderer.invoke(
      'observations:restore',
      studyId,
      observationID,
      fields
    )
  },
```

- [ ] **Step 3: Smoke check — start app**

```
npm run dev
```

Expected: app starts without errors. (No way to exercise `window.api.restoreObservation` from UI yet — that comes in Task 8+.)

- [ ] **Step 4: Commit**

```
git add src/main/ipc/observations.js src/preload/index.js
git commit -m "feat(ipc): expose observations:restore for undo path"
```

---

## Task 4 — `UndoManager` class

**Why:** Holds the two stacks, runs forward/inverse/redo, enforces the 100-cap, fires pulse events. Pure logic — no React, fully unit-testable.

**Files:**
- Create: `src/renderer/src/undo/UndoManager.js`
- Test: `test/renderer/undo/UndoManager.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/renderer/undo/UndoManager.test.js`:

```js
import { test, beforeEach, describe } from 'node:test'
import assert from 'node:assert/strict'

import { UndoManager } from '../../../src/renderer/src/undo/UndoManager.js'

function makeCommand(overrides = {}) {
  const calls = { forward: 0, inverse: 0, redo: 0 }
  return {
    calls,
    command: {
      entry: { type: 'update-bbox', mediaId: 'm1', observationId: 'o1', before: {}, after: {} },
      forward: async () => {
        calls.forward++
      },
      inverse: async () => {
        calls.inverse++
      },
      redo: async () => {
        calls.redo++
      },
      ...overrides
    }
  }
}

describe('UndoManager', () => {
  test('exec runs forward and pushes to undoStack', async () => {
    const mgr = new UndoManager()
    const { command, calls } = makeCommand()

    await mgr.exec(command)

    assert.equal(calls.forward, 1)
    assert.equal(mgr.canUndo(), true)
    assert.equal(mgr.canRedo(), false)
  })

  test('undo pops from undoStack, runs inverse, pushes to redoStack', async () => {
    const mgr = new UndoManager()
    const { command, calls } = makeCommand()

    await mgr.exec(command)
    await mgr.undo()

    assert.equal(calls.inverse, 1)
    assert.equal(mgr.canUndo(), false)
    assert.equal(mgr.canRedo(), true)
  })

  test('redo pops from redoStack, runs redo, pushes back to undoStack', async () => {
    const mgr = new UndoManager()
    const { command, calls } = makeCommand()

    await mgr.exec(command)
    await mgr.undo()
    await mgr.redo()

    assert.equal(calls.redo, 1)
    assert.equal(mgr.canUndo(), true)
    assert.equal(mgr.canRedo(), false)
  })

  test('a fresh exec clears the redoStack', async () => {
    const mgr = new UndoManager()
    const a = makeCommand()
    const b = makeCommand()

    await mgr.exec(a.command)
    await mgr.undo()
    assert.equal(mgr.canRedo(), true)

    await mgr.exec(b.command)
    assert.equal(mgr.canRedo(), false)
  })

  test('caps undoStack at 100 entries — drops oldest on overflow', async () => {
    const mgr = new UndoManager()
    for (let i = 0; i < 105; i++) {
      await mgr.exec(makeCommand().command)
    }
    assert.equal(mgr.undoStackSize(), 100)
  })

  test('undo failure drops the entry and emits no redo', async () => {
    const mgr = new UndoManager()
    const failing = makeCommand({
      inverse: async () => {
        throw new Error('IPC failed')
      }
    })

    await mgr.exec(failing.command)

    let onErrorMsg = null
    mgr.onError((msg) => {
      onErrorMsg = msg
    })

    await mgr.undo()

    assert.match(onErrorMsg ?? '', /IPC failed/)
    assert.equal(mgr.canUndo(), false)
    assert.equal(mgr.canRedo(), false)
  })

  test('emits pulse(observationId) after a successful undo', async () => {
    const mgr = new UndoManager()
    const { command } = makeCommand()
    const pulses = []
    mgr.onPulse((id) => pulses.push(id))

    await mgr.exec(command)
    await mgr.undo()

    assert.deepEqual(pulses, ['o1'])
  })

  test('clear() empties both stacks', async () => {
    const mgr = new UndoManager()
    await mgr.exec(makeCommand().command)
    await mgr.exec(makeCommand().command)
    await mgr.undo()

    mgr.clear()

    assert.equal(mgr.canUndo(), false)
    assert.equal(mgr.canRedo(), false)
  })

  test('navigateTo handler is called when entry.mediaId differs from currentMediaIdRef', async () => {
    const navigated = []
    const mgr = new UndoManager({
      getCurrentMediaId: () => 'mB',
      navigateTo: async (mediaId) => {
        navigated.push(mediaId)
      }
    })
    const { command } = makeCommand() // entry.mediaId = 'm1'

    await mgr.exec(command)
    await mgr.undo()

    assert.deepEqual(navigated, ['m1'])
  })

  test('navigateTo not called when entry.mediaId matches current', async () => {
    const navigated = []
    const mgr = new UndoManager({
      getCurrentMediaId: () => 'm1',
      navigateTo: async (mediaId) => {
        navigated.push(mediaId)
      }
    })
    const { command } = makeCommand()

    await mgr.exec(command)
    await mgr.undo()

    assert.deepEqual(navigated, [])
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```
npm test -- --test-name-pattern="UndoManager"
```

Expected: import fails — file doesn't exist.

- [ ] **Step 3: Implement `UndoManager`**

Create `src/renderer/src/undo/UndoManager.js`:

```js
const STACK_CAP = 100

export class UndoManager {
  constructor({ getCurrentMediaId, navigateTo } = {}) {
    this.undoStack = []
    this.redoStack = []
    this.getCurrentMediaId = getCurrentMediaId ?? (() => null)
    this.navigateTo = navigateTo ?? (async () => {})
    this.errorListeners = new Set()
    this.pulseListeners = new Set()
    this.changeListeners = new Set()
  }

  canUndo() {
    return this.undoStack.length > 0
  }

  canRedo() {
    return this.redoStack.length > 0
  }

  undoStackSize() {
    return this.undoStack.length
  }

  redoStackSize() {
    return this.redoStack.length
  }

  async exec(command) {
    await command.forward()
    this.undoStack.push(command)
    if (this.undoStack.length > STACK_CAP) {
      this.undoStack.shift()
    }
    this.redoStack.length = 0
    this._notifyChange()
  }

  async undo() {
    if (this.undoStack.length === 0) return
    const command = this.undoStack.pop()
    try {
      await this._navigateIfNeeded(command.entry.mediaId)
      await command.inverse()
    } catch (err) {
      this._emitError(`Couldn't undo: ${err.message}`)
      this._notifyChange()
      return
    }
    this.redoStack.push(command)
    this._emitPulse(command.entry.observationId)
    this._notifyChange()
  }

  async redo() {
    if (this.redoStack.length === 0) return
    const command = this.redoStack.pop()
    try {
      await this._navigateIfNeeded(command.entry.mediaId)
      await command.redo()
    } catch (err) {
      this._emitError(`Couldn't redo: ${err.message}`)
      this._notifyChange()
      return
    }
    this.undoStack.push(command)
    this._emitPulse(command.entry.observationId)
    this._notifyChange()
  }

  clear() {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this._notifyChange()
  }

  onError(fn) {
    this.errorListeners.add(fn)
    return () => this.errorListeners.delete(fn)
  }

  onPulse(fn) {
    this.pulseListeners.add(fn)
    return () => this.pulseListeners.delete(fn)
  }

  onChange(fn) {
    this.changeListeners.add(fn)
    return () => this.changeListeners.delete(fn)
  }

  async _navigateIfNeeded(mediaId) {
    if (mediaId && this.getCurrentMediaId() !== mediaId) {
      await this.navigateTo(mediaId)
    }
  }

  _emitError(msg) {
    for (const fn of this.errorListeners) fn(msg)
  }

  _emitPulse(id) {
    for (const fn of this.pulseListeners) fn(id)
  }

  _notifyChange() {
    for (const fn of this.changeListeners) fn()
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

```
npm test -- --test-name-pattern="UndoManager"
```

Expected: all 9 passing.

- [ ] **Step 5: Commit**

```
git add src/renderer/src/undo/UndoManager.js test/renderer/undo/UndoManager.test.js
git commit -m "feat(undo): UndoManager class with bounded stacks and pulse events"
```

---

## Task 5 — Command builders

**Why:** Encapsulates the IPC dispatch for each of the 4 op types. Pure builders return the `{ entry, forward, inverse, redo }` shape `UndoManager.exec()` expects.

**Files:**
- Create: `src/renderer/src/undo/commands.js`
- Test: `test/renderer/undo/commands.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/renderer/undo/commands.test.js`:

```js
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import * as commands from '../../../src/renderer/src/undo/commands.js'

function fakeApi() {
  const calls = []
  return {
    calls,
    api: {
      createObservation: async (studyId, data) => {
        calls.push(['create', studyId, data])
        return { data: { ...data, observationID: data.observationID ?? 'new-id' } }
      },
      deleteObservation: async (studyId, id) => {
        calls.push(['delete', studyId, id])
        return { data: { success: true, observationID: id } }
      },
      updateObservationBbox: async (studyId, id, bbox) => {
        calls.push(['update-bbox', studyId, id, bbox])
        return { data: { observationID: id, ...bbox } }
      },
      updateObservationClassification: async (studyId, id, updates) => {
        calls.push(['update-classification', studyId, id, updates])
        return { data: { observationID: id, ...updates } }
      },
      restoreObservation: async (studyId, id, fields) => {
        calls.push(['restore', studyId, id, fields])
        return { data: { observationID: id, ...fields } }
      }
    }
  }
}

describe('commands.create', () => {
  test('forward calls createObservation; inverse calls deleteObservation', async () => {
    const { api, calls } = fakeApi()
    const cmd = commands.create({
      api,
      studyId: 's1',
      mediaId: 'm1',
      observationData: {
        mediaID: 'm1',
        deploymentID: 'd1',
        timestamp: 't',
        bboxX: 0.1,
        bboxY: 0.1,
        bboxWidth: 0.1,
        bboxHeight: 0.1
      }
    })

    await cmd.forward()
    assert.equal(calls[0][0], 'create')
    assert.equal(cmd.entry.type, 'create')
    assert.equal(cmd.entry.mediaId, 'm1')
    assert.ok(cmd.entry.after?.observationID)

    await cmd.inverse()
    assert.deepEqual(calls[1], ['delete', 's1', cmd.entry.after.observationID])

    await cmd.redo()
    // redo recreates with the SAME observationID stored in entry.after
    const redoCall = calls[2]
    assert.equal(redoCall[0], 'create')
    assert.equal(redoCall[2].observationID, cmd.entry.after.observationID)
  })
})

describe('commands.delete', () => {
  test('forward calls deleteObservation; inverse calls createObservation with original IDs', async () => {
    const { api, calls } = fakeApi()
    const before = {
      observationID: 'obs-X',
      eventID: 'evt-X',
      mediaID: 'm1',
      deploymentID: 'd1',
      eventStart: 't',
      eventEnd: 't',
      scientificName: 'capreolus capreolus',
      commonName: 'Roe Deer',
      observationType: 'animal',
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2,
      sex: null,
      lifeStage: null,
      behavior: null,
      classificationMethod: 'machine',
      classifiedBy: 'SpeciesNet 4.0.1a',
      classificationTimestamp: '2024-01-01T00:00:00.000Z',
      classificationProbability: 0.9
    }

    const cmd = commands.delete_({
      api,
      studyId: 's1',
      mediaId: 'm1',
      before
    })

    await cmd.forward()
    assert.deepEqual(calls[0], ['delete', 's1', 'obs-X'])
    assert.equal(cmd.entry.type, 'delete')
    assert.equal(cmd.entry.before.observationID, 'obs-X')

    await cmd.inverse()
    const inverseCall = calls[1]
    assert.equal(inverseCall[0], 'create')
    assert.equal(inverseCall[2].observationID, 'obs-X')
    assert.equal(inverseCall[2].eventID, 'evt-X')
    assert.equal(inverseCall[2].scientificName, 'capreolus capreolus')
  })
})

describe('commands.updateBbox', () => {
  test('forward calls updateObservationBbox; inverse calls restoreObservation with before-state', async () => {
    const { api, calls } = fakeApi()
    const before = {
      bboxX: 0.1,
      bboxY: 0.1,
      bboxWidth: 0.2,
      bboxHeight: 0.2,
      classificationMethod: 'machine',
      classifiedBy: 'SpeciesNet 4.0.1a',
      classificationTimestamp: '2024-01-01T00:00:00.000Z',
      classificationProbability: 0.9
    }
    const after = { bboxX: 0.5, bboxY: 0.5, bboxWidth: 0.1, bboxHeight: 0.1 }
    const cmd = commands.updateBbox({
      api,
      studyId: 's1',
      mediaId: 'm1',
      observationId: 'obs-Y',
      before,
      after
    })

    await cmd.forward()
    assert.equal(calls[0][0], 'update-bbox')
    assert.deepEqual(calls[0][3], after)

    await cmd.inverse()
    assert.equal(calls[1][0], 'restore')
    assert.deepEqual(calls[1][3], before)

    await cmd.redo()
    assert.equal(calls[2][0], 'restore')
    // redo restores to `after` state (no auto-stamping — undo paths are stamp-free)
    assert.equal(calls[2][3].bboxX, 0.5)
  })
})

describe('commands.updateClassification', () => {
  test('forward calls updateObservationClassification; inverse calls restoreObservation', async () => {
    const { api, calls } = fakeApi()
    const before = {
      scientificName: 'lepus europaeus',
      commonName: 'European Hare',
      observationType: 'animal',
      sex: null,
      lifeStage: null,
      behavior: null,
      classificationMethod: 'machine',
      classifiedBy: 'SpeciesNet 4.0.1a',
      classificationTimestamp: '2024-01-01T00:00:00.000Z',
      classificationProbability: 0.85
    }
    const after = { scientificName: 'capreolus capreolus', commonName: 'Roe Deer' }
    const cmd = commands.updateClassification({
      api,
      studyId: 's1',
      mediaId: 'm1',
      observationId: 'obs-Z',
      before,
      after
    })

    await cmd.forward()
    assert.equal(calls[0][0], 'update-classification')

    await cmd.inverse()
    assert.equal(calls[1][0], 'restore')
    assert.equal(calls[1][3].scientificName, 'lepus europaeus')
    assert.equal(calls[1][3].classificationMethod, 'machine')
  })
})

describe('throws on IPC error response', () => {
  test('forward throws when api returns { error }', async () => {
    const api = {
      updateObservationBbox: async () => ({ error: 'DB error' })
    }
    const cmd = commands.updateBbox({
      api,
      studyId: 's1',
      mediaId: 'm1',
      observationId: 'obs-Y',
      before: { bboxX: 0.1, bboxY: 0.1, bboxWidth: 0.1, bboxHeight: 0.1 },
      after: { bboxX: 0.5, bboxY: 0.5, bboxWidth: 0.1, bboxHeight: 0.1 }
    })

    await assert.rejects(() => cmd.forward(), /DB error/)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```
npm test -- --test-name-pattern="commands\\."
```

Expected: import fails — `commands.js` doesn't exist.

- [ ] **Step 3: Implement `commands.js`**

Create `src/renderer/src/undo/commands.js`:

```js
function unwrap(response, op) {
  if (response.error) throw new Error(response.error)
  return response.data
}

// Subset of fields we capture/restore for bbox-update inverses.
// Includes classification metadata so undo restores ML-stamping if the
// pre-state was machine-classified.
const BBOX_RESTORE_FIELDS = [
  'bboxX',
  'bboxY',
  'bboxWidth',
  'bboxHeight',
  'classificationMethod',
  'classifiedBy',
  'classificationTimestamp',
  'classificationProbability'
]

const CLASSIFICATION_RESTORE_FIELDS = [
  'scientificName',
  'commonName',
  'observationType',
  'sex',
  'lifeStage',
  'behavior',
  'classificationMethod',
  'classifiedBy',
  'classificationTimestamp',
  'classificationProbability'
]

function pick(obj, keys) {
  const out = {}
  for (const k of keys) out[k] = obj[k] ?? null
  return out
}

export function create({ api, studyId, mediaId, observationData }) {
  // entry.after is filled in after forward() runs (because the new ID lives there)
  const entry = {
    type: 'create',
    mediaId,
    observationId: null,
    before: null,
    after: null
  }

  return {
    entry,
    forward: async () => {
      const data = unwrap(await api.createObservation(studyId, observationData), 'create')
      entry.observationId = data.observationID
      entry.after = data
    },
    inverse: async () => {
      unwrap(await api.deleteObservation(studyId, entry.observationId), 'delete')
    },
    redo: async () => {
      // Recreate with the same observationID + eventID so any later stack
      // entries that reference this observation remain valid.
      unwrap(
        await api.createObservation(studyId, {
          ...entry.after,
          mediaID: entry.after.mediaID,
          deploymentID: entry.after.deploymentID,
          timestamp: entry.after.eventStart,
          observationID: entry.after.observationID,
          eventID: entry.after.eventID
        }),
        'create'
      )
    }
  }
}

// `delete` is a reserved word in JS — exported as `delete_`, callers use
// `commands.delete_(...)` (or `commands['delete'](...)`). Keep this comment so
// the JS reserved-word collision isn't mysterious.
export function delete_({ api, studyId, mediaId, before }) {
  const entry = {
    type: 'delete',
    mediaId,
    observationId: before.observationID,
    before,
    after: null
  }

  return {
    entry,
    forward: async () => {
      unwrap(await api.deleteObservation(studyId, before.observationID), 'delete')
    },
    inverse: async () => {
      // Recreate with the original observationID + eventID. createObservation
      // accepts these as optional explicit IDs (see Task 1).
      unwrap(
        await api.createObservation(studyId, {
          mediaID: before.mediaID,
          deploymentID: before.deploymentID,
          timestamp: before.eventStart,
          observationID: before.observationID,
          eventID: before.eventID,
          scientificName: before.scientificName,
          commonName: before.commonName,
          bboxX: before.bboxX,
          bboxY: before.bboxY,
          bboxWidth: before.bboxWidth,
          bboxHeight: before.bboxHeight,
          sex: before.sex,
          lifeStage: before.lifeStage,
          behavior: before.behavior
        }),
        'create'
      )
      // createObservation auto-stamps human classification metadata. To restore
      // the original (possibly machine-classified) state, follow with a
      // stamp-free restore of the metadata fields.
      unwrap(
        await api.restoreObservation(studyId, before.observationID, {
          observationType: before.observationType,
          classificationMethod: before.classificationMethod,
          classifiedBy: before.classifiedBy,
          classificationTimestamp: before.classificationTimestamp,
          classificationProbability: before.classificationProbability
        }),
        'restore'
      )
    },
    redo: async () => {
      unwrap(await api.deleteObservation(studyId, before.observationID), 'delete')
    }
  }
}

export function updateBbox({ api, studyId, mediaId, observationId, before, after }) {
  const beforeFields = pick(before, BBOX_RESTORE_FIELDS)
  const afterFields = { ...beforeFields, ...pick(after, ['bboxX', 'bboxY', 'bboxWidth', 'bboxHeight']) }

  const entry = {
    type: 'update-bbox',
    mediaId,
    observationId,
    before: beforeFields,
    after: afterFields
  }

  return {
    entry,
    forward: async () => {
      unwrap(
        await api.updateObservationBbox(studyId, observationId, {
          bboxX: after.bboxX,
          bboxY: after.bboxY,
          bboxWidth: after.bboxWidth,
          bboxHeight: after.bboxHeight
        }),
        'update-bbox'
      )
    },
    inverse: async () => {
      unwrap(await api.restoreObservation(studyId, observationId, beforeFields), 'restore')
    },
    redo: async () => {
      unwrap(await api.restoreObservation(studyId, observationId, afterFields), 'restore')
    }
  }
}

export function updateClassification({ api, studyId, mediaId, observationId, before, after }) {
  const beforeFields = pick(before, CLASSIFICATION_RESTORE_FIELDS)
  // afterFields keeps unchanged fields from before, layers in changed ones,
  // and replaces metadata with the human-stamp values that the forward IPC
  // would have applied.
  const afterFields = {
    ...beforeFields,
    ...after,
    classificationMethod: 'human',
    classifiedBy: 'User',
    classificationProbability: null
    // classificationTimestamp gets re-stamped by the forward IPC; we capture
    // the actual value after forward() resolves.
  }

  const entry = {
    type: 'update-classification',
    mediaId,
    observationId,
    before: beforeFields,
    after: afterFields
  }

  return {
    entry,
    forward: async () => {
      const data = unwrap(
        await api.updateObservationClassification(studyId, observationId, after),
        'update-classification'
      )
      // Capture the actual classificationTimestamp the forward IPC stamped, so
      // redo can restore the same timestamp (preserving CamtrapDP semantics).
      if (data?.classificationTimestamp) {
        afterFields.classificationTimestamp = data.classificationTimestamp
      }
    },
    inverse: async () => {
      unwrap(await api.restoreObservation(studyId, observationId, beforeFields), 'restore')
    },
    redo: async () => {
      unwrap(await api.restoreObservation(studyId, observationId, afterFields), 'restore')
    }
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

```
npm test -- --test-name-pattern="commands\\."
```

Expected: all passing.

- [ ] **Step 5: Commit**

```
git add src/renderer/src/undo/commands.js test/renderer/undo/commands.test.js
git commit -m "feat(undo): command builders for the four observation mutations"
```

---

## Task 6 — `useUndo` hook + `UndoProvider`

**Why:** Idiomatic way to get the manager from any component and re-render on `canUndo` / `canRedo` changes.

**Files:**
- Create: `src/renderer/src/undo/context.jsx`

- [ ] **Step 1: Implement context + hook**

Create `src/renderer/src/undo/context.jsx`:

```jsx
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { UndoManager } from './UndoManager.js'

const UndoContext = createContext(null)

export function UndoProvider({ children, getCurrentMediaId, navigateTo }) {
  const callbacksRef = useRef({ getCurrentMediaId, navigateTo })
  callbacksRef.current = { getCurrentMediaId, navigateTo }

  const manager = useMemo(
    () =>
      new UndoManager({
        getCurrentMediaId: () => callbacksRef.current.getCurrentMediaId?.() ?? null,
        navigateTo: async (id) => {
          await callbacksRef.current.navigateTo?.(id)
        }
      }),
    []
  )

  // Re-render consumers when stacks change so canUndo / canRedo stay accurate.
  const [, force] = useState(0)
  useEffect(() => manager.onChange(() => force((n) => n + 1)), [manager])

  return <UndoContext.Provider value={manager}>{children}</UndoContext.Provider>
}

export function useUndo() {
  const manager = useContext(UndoContext)
  if (!manager) {
    throw new Error('useUndo must be used inside <UndoProvider>')
  }
  return manager
}
```

- [ ] **Step 2: Smoke check — type check + lint**

```
npm run lint
```

Expected: no errors in the new files.

- [ ] **Step 3: Commit**

```
git add src/renderer/src/undo/context.jsx
git commit -m "feat(undo): UndoProvider context + useUndo hook"
```

---

## Task 7 — Mount `UndoProvider` in `Gallery.jsx`

**Why:** Establishes the study-session-scoped manager. Provider lives at the top of the modal subtree so all four mutation sites can reach it via `useUndo()`. Manager is reset on study switch via React's natural unmount/remount of the provider.

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx`

**Note on component layout:** The four mutations (`updateMutation`, `updateBboxMutation`, `deleteMutation`, `createMutation`, lines ~540-748) live in the **inner modal component** (`ImageModal`-like, defined around line 211 — it receives `media` as a prop). Navigation state (`selectedMedia`, `setSelectedMedia`, `allNavigableItems`, `handleNextImage`) lives in the **outer Gallery component** (around line 1800-2450). The outer component renders the inner modal at ~line 2445 (`media={selectedMedia}`). The `UndoProvider` must wrap somewhere both can see it — putting it in the outer component, around the modal render, is correct.

- [ ] **Step 1: Add the `navigateToMediaId` helper in the outer Gallery component**

Add near `handleNextImage` (around line 2358):

```js
// Jump the modal to a specific mediaId (used by the undo system to surface
// the affected image when undoing/redoing edits made elsewhere). Mirrors
// the state mutations handleNextImage performs but resolves by id.
const navigateToMediaId = useCallback(
  async (targetMediaId) => {
    if (!targetMediaId || selectedMedia?.mediaID === targetMediaId) return
    const seq = allNavigableItems.find((s) =>
      s.items.some((m) => m.mediaID === targetMediaId)
    )
    if (!seq) return // target not in currently loaded pages — best-effort no-op
    const itemIdx = seq.items.findIndex((m) => m.mediaID === targetMediaId)
    const isMultiItem = seq.items.length > 1
    setCurrentSequence(isMultiItem ? seq : null)
    setCurrentSequenceIndex(itemIdx >= 0 ? itemIdx : 0)
    setSelectedMedia(seq.items[itemIdx >= 0 ? itemIdx : 0])
  },
  [allNavigableItems, selectedMedia, setCurrentSequence, setCurrentSequenceIndex, setSelectedMedia]
)
```

- [ ] **Step 2: Wrap the outer Gallery's modal render with `UndoProvider`**

At the top of `Gallery.jsx`:

```jsx
import { UndoProvider } from '../undo/context.jsx'
```

In the outer Gallery component, near `selectedMedia`, add a ref so the manager can read the current mediaId without re-renders:

```js
const selectedMediaIdRef = useRef(selectedMedia?.mediaID)
useEffect(() => {
  selectedMediaIdRef.current = selectedMedia?.mediaID
}, [selectedMedia?.mediaID])
```

Wrap the modal element (around line 2445) with `UndoProvider`:

```jsx
<UndoProvider
  getCurrentMediaId={() => selectedMediaIdRef.current}
  navigateTo={navigateToMediaId}
>
  <ImageModal
    media={selectedMedia}
    onNext={handleNextImage}
    onPrevious={handlePreviousImage}
    {/* …existing props… */}
  />
</UndoProvider>
```

(Use the actual modal component name and props from the existing render — the snippet above is illustrative.)

- [ ] **Step 3: Smoke check**

```
npm run dev
```

Expected: app opens, modal navigation still works via arrow keys.

- [ ] **Step 4: Commit**

```
git add src/renderer/src/media/Gallery.jsx
git commit -m "feat(undo): mount UndoProvider in Gallery with navigateTo wiring"
```

---

## Task 8 — Route `createMutation` through `undo.exec`

**Why:** Make the create-observation flow record an undo entry without breaking the existing optimistic-update + cache-invalidation behavior.

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx` (around the existing `createMutation` and its call sites at lines 723-748, 775-812)

- [ ] **Step 1: Replace direct `createMutation.mutate(...)` calls with `undo.exec(...)`**

In `handleDrawComplete` (line 775) and `handleAddWholeImage` (line 799), change:

```js
createMutation.mutate(observationData)
```

to:

```js
import * as commands from '../undo/commands.js'
// ... (top of file)

undo.exec(commands.create({
  api: window.api,
  studyId,
  mediaId: media.mediaID,
  observationData
}))
```

Where `undo = useUndo()` is grabbed at the top of the component.

The existing `createMutation` (with its `onSuccess` cache invalidations) is no longer used directly for the user-action path — but its invalidation logic is still needed. Two options:

**Option A (simpler):** Inline the invalidation into a helper that runs after `undo.exec`:

```js
const invalidateAfterCreate = useCallback(() => {
  queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })
  queryClient.invalidateQueries({ queryKey: ['distinctSpecies', studyId] })
  queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
  queryClient.invalidateQueries({ queryKey: ['sequences', studyId] })
  queryClient.invalidateQueries({ queryKey: ['sequenceAwareSpeciesDistribution', studyId] })
  queryClient.invalidateQueries({ queryKey: ['sequenceAwareTimeseries', studyId] })
  queryClient.invalidateQueries({ queryKey: ['sequenceAwareDailyActivity', studyId] })
  queryClient.invalidateQueries({ queryKey: ['sequenceAwareHeatmap', studyId] })
  queryClient.invalidateQueries({ queryKey: ['blankMediaCount', studyId] })
  queryClient.invalidateQueries({ queryKey: ['vehicleMediaCount', studyId] })
  queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
}, [queryClient, studyId, media?.mediaID])

const handleDrawComplete = useCallback(
  async (bbox) => {
    if (!media) return
    const defaultSpecies = getDefaultSpecies()
    const observationData = {
      mediaID: media.mediaID,
      deploymentID: media.deploymentID,
      timestamp: media.timestamp,
      scientificName: defaultSpecies.scientificName,
      commonName: defaultSpecies.commonName,
      bboxX: bbox.bboxX,
      bboxY: bbox.bboxY,
      bboxWidth: bbox.bboxWidth,
      bboxHeight: bbox.bboxHeight
    }

    const command = commands.create({
      api: window.api,
      studyId,
      mediaId: media.mediaID,
      observationData
    })
    await undo.exec(command)

    invalidateAfterCreate()
    setIsDrawMode(false)
    setSelectedObservationId(command.entry.observationId)
  },
  [media, getDefaultSpecies, studyId, undo, invalidateAfterCreate]
)
```

Apply the same pattern to `handleAddWholeImage`:

```js
const handleAddWholeImage = useCallback(async () => {
  if (!media) return
  const observationData = {
    mediaID: media.mediaID,
    deploymentID: media.deploymentID,
    timestamp: media.timestamp,
    scientificName: null,
    commonName: null,
    bboxX: null,
    bboxY: null,
    bboxWidth: null,
    bboxHeight: null
  }

  const command = commands.create({
    api: window.api,
    studyId,
    mediaId: media.mediaID,
    observationData
  })
  await undo.exec(command)

  invalidateAfterCreate()
  setIsDrawMode(false)
  setSelectedObservationId(command.entry.observationId)
}, [media, studyId, undo, invalidateAfterCreate])
```

- [ ] **Step 2: Delete the now-unused `createMutation` block (lines 723-748)**

Remove `createMutation = useMutation(...)` since nothing calls it anymore. The `onSuccess` side effects (invalidations, `setIsDrawMode`, `setSelectedObservationId`) all live inline in the new handler.

- [ ] **Step 3: Smoke check**

```
npm run dev
```

Manually test: open a media item, draw a bbox, confirm it appears, confirm species cards on Overview update. Press `Cmd+Z` (will not work yet — keyboard binding comes in Task 12). Open the React Query devtools if available to confirm the cache invalidations still fire.

- [ ] **Step 4: Commit**

```
git add src/renderer/src/media/Gallery.jsx
git commit -m "feat(undo): route create-observation through undo.exec"
```

---

## Task 9 — Route `deleteMutation` through `undo.exec`

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx` (around lines 664-720)

- [ ] **Step 1: Replace `handleDeleteObservation` body**

Snapshot the full observation row from cache *before* deletion (so the inverse can recreate it):

```js
const handleDeleteObservation = useCallback(
  async (observationID) => {
    const cached = queryClient.getQueryData(['mediaBboxes', studyId, media?.mediaID])
    const before = cached?.find((b) => b.observationID === observationID)
    if (!before) return

    const command = commands.delete_({
      api: window.api,
      studyId,
      mediaId: media.mediaID,
      before
    })
    await undo.exec(command)

    // Same invalidations the old deleteMutation.onSettled fired
    queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })
    queryClient.invalidateQueries({ queryKey: ['distinctSpecies', studyId] })
    queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
    queryClient.invalidateQueries({ queryKey: ['sequences', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareSpeciesDistribution', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareTimeseries', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareDailyActivity', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareHeatmap', studyId] })
    queryClient.invalidateQueries({ queryKey: ['blankMediaCount', studyId] })
    queryClient.invalidateQueries({ queryKey: ['vehicleMediaCount', studyId] })
    queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })

    if (selectedObservationId === observationID) {
      setSelectedObservationId(null)
    }
  },
  [queryClient, studyId, media?.mediaID, undo, selectedObservationId]
)
```

- [ ] **Step 2: Delete the now-unused `deleteMutation` block (lines 664-713)**

- [ ] **Step 3: Smoke check**

```
npm run dev
```

Test: delete an observation via Del key or delete button, confirm it disappears, confirm species counts update.

- [ ] **Step 4: Commit**

```
git add src/renderer/src/media/Gallery.jsx
git commit -m "feat(undo): route delete-observation through undo.exec"
```

---

## Task 10 — Route `updateBboxMutation` through `undo.exec`

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx` (around lines 615-661)

- [ ] **Step 1: Replace `handleBboxUpdate`**

```js
const handleBboxUpdate = useCallback(
  async (observationID, newBbox) => {
    const cached = queryClient.getQueryData(['mediaBboxes', studyId, media?.mediaID])
    const before = cached?.find((b) => b.observationID === observationID)
    if (!before) return

    // Optimistic UI: same patch the old onMutate did
    await queryClient.cancelQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })
    const previous = queryClient.getQueryData(['mediaBboxes', studyId, media?.mediaID])
    queryClient.setQueryData(['mediaBboxes', studyId, media?.mediaID], (old) =>
      old?.map((b) =>
        b.observationID === observationID
          ? { ...b, ...newBbox, classificationMethod: 'human' }
          : b
      )
    )

    try {
      const command = commands.updateBbox({
        api: window.api,
        studyId,
        mediaId: media.mediaID,
        observationId: observationID,
        before,
        after: newBbox
      })
      await undo.exec(command)

      queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })
      queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
      queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
    } catch {
      // Rollback optimistic update — undo manager already pushed nothing on failure
      queryClient.setQueryData(['mediaBboxes', studyId, media?.mediaID], previous)
    }
  },
  [queryClient, studyId, media?.mediaID, undo]
)
```

- [ ] **Step 2: Delete the now-unused `updateBboxMutation` block (lines 615-654)**

- [ ] **Step 3: Smoke check**

```
npm run dev
```

Test: drag a bbox, confirm new position persists. Nudge with arrow keys, confirm each nudge is committed.

- [ ] **Step 4: Commit**

```
git add src/renderer/src/media/Gallery.jsx
git commit -m "feat(undo): route bbox-update through undo.exec"
```

---

## Task 11 — Route classification updates (`updateMutation`) through `undo.exec`

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx` (the `updateMutation` block at line 545 and any callers passing classification updates down)

- [ ] **Step 1: Add a `handleClassificationUpdate` callback**

The existing classification mutation is named `updateMutation` (line 545). Replace its callers with a new handler:

```js
const handleClassificationUpdate = useCallback(
  async (observationID, updates) => {
    const cached = queryClient.getQueryData(['mediaBboxes', studyId, media?.mediaID])
    const before = cached?.find((b) => b.observationID === observationID)
    if (!before) return

    const command = commands.updateClassification({
      api: window.api,
      studyId,
      mediaId: media.mediaID,
      observationId: observationID,
      before,
      after: updates
    })
    await undo.exec(command)

    queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })
    queryClient.invalidateQueries({ queryKey: ['distinctSpecies', studyId] })
    queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
    queryClient.invalidateQueries({ queryKey: ['sequences', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareSpeciesDistribution', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareTimeseries', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareDailyActivity', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareHeatmap', studyId] })
    queryClient.invalidateQueries({ queryKey: ['blankMediaCount', studyId] })
    queryClient.invalidateQueries({ queryKey: ['vehicleMediaCount', studyId] })
    queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
  },
  [queryClient, studyId, media?.mediaID, undo]
)
```

- [ ] **Step 2: Update all `updateMutation.mutate(...)` call sites**

Anywhere `updateMutation.mutate(...)` is called, switch to `handleClassificationUpdate(observationID, updates)`. Search:

```
grep -n "updateMutation.mutate\|updateMutation\.\|onClassification" src/renderer/src/media/Gallery.jsx src/renderer/src/ui/ObservationRow.jsx
```

Most call sites are inside `ObservationRow.jsx` via a prop callback. Keep that prop API stable — only swap the implementation passed in from `Gallery.jsx`.

- [ ] **Step 3: Delete the now-unused `updateMutation` block (line 545+)**

- [ ] **Step 4: Smoke check**

```
npm run dev
```

Test: change a species in the picker, confirm the change persists, confirm species cards on Overview update. Change sex/life-stage/behavior dropdowns; same checks.

- [ ] **Step 5: Commit**

```
git add src/renderer/src/media/Gallery.jsx src/renderer/src/ui/ObservationRow.jsx
git commit -m "feat(undo): route classification-update through undo.exec"
```

---

## Task 12 — Bind `Cmd+Z` / `Cmd+Shift+Z` and auto-navigation

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx` (the existing `handleKeyDown` around line 817)

- [ ] **Step 1: Add the shortcut branch to `handleKeyDown`**

Inside the existing `useEffect` that registers `handleKeyDown` (around line 814-824), add:

```js
// Cmd+Z / Ctrl+Z → undo. Skip when an editable element has focus so the
// species picker's text field still gets native text undo.
const isEditable = (el) =>
  el &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable)

if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z' && !isEditable(document.activeElement)) {
  e.preventDefault()
  undo.undo()
  return
}

if (
  ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') ||
  ((e.metaKey || e.ctrlKey) && e.key === 'y')
) {
  if (isEditable(document.activeElement)) return
  e.preventDefault()
  undo.redo()
  return
}
```

Place these branches *before* the existing Tab / Arrow / Del handlers — they should take precedence.

- [ ] **Step 2: Confirm `undo` is in the effect's dep list**

```js
}, [..., undo])
```

- [ ] **Step 3: Smoke check (manual, multi-step)**

```
npm run dev
```

Run all four scenarios end-to-end:

1. **Single-image undo/redo:**
   - Edit a bbox → `Cmd+Z` → bbox reverts → `Cmd+Shift+Z` → bbox re-applies.
   - Delete an observation → `Cmd+Z` → observation reappears with same UUID.
   - Change species → `Cmd+Z` → reverts.
   - Draw a new bbox → `Cmd+Z` → it disappears.

2. **Auto-navigation:**
   - Edit a bbox on image A. Use `→` to navigate to image B. `Cmd+Z` → modal jumps back to image A and the bbox reverts.

3. **No interference with text input:**
   - Click into the species picker text field, type something, press `Cmd+Z` → native text undo runs (not annotation undo).

4. **Stack cap:**
   - Make 105 small edits. `Cmd+Z` 105 times — only 100 actually undo (oldest dropped).

- [ ] **Step 4: Commit**

```
git add src/renderer/src/media/Gallery.jsx
git commit -m "feat(undo): keyboard shortcuts (Cmd+Z / Cmd+Shift+Z) with auto-navigation"
```

---

## Task 13 — Pulse visual feedback

**Files:**
- Modify: `src/renderer/src/ui/EditableBbox.jsx` (subscribe to pulse events, toggle class)
- Modify: existing bbox stylesheet (locate via `grep -rn "EditableBbox\|bbox" src/renderer/src/assets/`) — add `.bbox--pulse` keyframes.

- [ ] **Step 1: Add the keyframe animation**

Add to the bbox stylesheet (or `main.css` if no dedicated bbox sheet):

```css
@keyframes bbox-pulse {
  0% {
    outline: 2px solid var(--accent, #4f9eff);
    outline-offset: 2px;
  }
  100% {
    outline: 2px solid transparent;
    outline-offset: 2px;
  }
}

.bbox--pulse {
  animation: bbox-pulse 600ms ease-out 1;
}
```

- [ ] **Step 2: Subscribe to pulse events in `EditableBbox`**

In `EditableBbox.jsx`, accept a `pulseRequest` prop or use the manager directly:

```jsx
import { useUndo } from '../undo/context.jsx'
import { useEffect, useState } from 'react'

export function EditableBbox({ observation, ...rest }) {
  const undo = useUndo()
  const [pulsing, setPulsing] = useState(false)

  useEffect(() => {
    return undo.onPulse((id) => {
      if (id !== observation.observationID) return
      setPulsing(true)
      setTimeout(() => setPulsing(false), 650)
    })
  }, [undo, observation.observationID])

  return (
    <g className={pulsing ? 'bbox--pulse' : ''} {...existingProps}>
      {/* existing rect/handles */}
    </g>
  )
}
```

If `EditableBbox` doesn't render an `<g>` group, attach the class to whatever wraps the bbox `<rect>`. The intent: outline animation around the bbox shape.

- [ ] **Step 3: Smoke check**

```
npm run dev
```

Test: edit a bbox, `Cmd+Z` → confirm a brief outline pulse on the affected bbox. Edit another bbox, navigate to a different image, `Cmd+Z` → confirm modal navigates and pulse runs after navigation settles.

- [ ] **Step 4: Commit**

```
git add src/renderer/src/ui/EditableBbox.jsx src/renderer/src/assets/main.css
git commit -m "feat(undo): bbox pulse animation on undo/redo"
```

---

## Task 14 — Failure toast

**Why:** When `inverse()` or `redo()` throws, the manager already drops the entry. We need to surface the error to the user.

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx` (subscribe to `manager.onError` and display)

- [ ] **Step 1: Find the existing toast mechanism**

```
grep -rn "toast\|notify" src/renderer/src/ | grep -v ".test.js" | head
```

If a toast helper exists (`useToast()`, `showToast()`, etc.), use it. If none, use a minimal inline solution: a `useState` for the most recent error and a small fixed-position div near the modal title.

- [ ] **Step 2: Wire `manager.onError`**

In `Gallery.jsx` (or the `UndoProvider` consumer of choice):

```jsx
const undo = useUndo()
const [undoError, setUndoError] = useState(null)

useEffect(() => {
  const off = undo.onError((msg) => {
    setUndoError(msg)
    setTimeout(() => setUndoError(null), 3500)
  })
  return off
}, [undo])

// in JSX, near top of modal:
{undoError && (
  <div className="undo-error-toast" role="status">
    {undoError}
  </div>
)}
```

Add a minimal toast style (small dark pill, top-right of modal area).

- [ ] **Step 3: Smoke check**

```
npm run dev
```

Hard to trigger naturally. Force a failure by temporarily editing `restoreObservation` to throw, then exercising undo — confirm the toast appears and the entry is dropped (next `Cmd+Z` does nothing instead of retrying the same failure).

Revert the temporary throw before committing.

- [ ] **Step 4: Commit**

```
git add src/renderer/src/media/Gallery.jsx src/renderer/src/assets/main.css
git commit -m "feat(undo): failure toast for undo/redo errors"
```

---

## Task 15 — Documentation

**Why:** `CLAUDE.md` mandates doc updates when IPC handlers change.

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/ipc-api.md`
- Modify: `docs/database-schema.md`

- [ ] **Step 1: `docs/architecture.md`**

Locate the directory-structure section / "key files" table. Add:

```
src/renderer/src/undo/
  UndoManager.js     - Stack class with undo/redo, pulse events, 100-entry cap
  commands.js        - Builders for the four observation mutation commands
  context.jsx        - UndoProvider + useUndo hook
```

If there's an IPC pattern diagram, add `observations:restore` next to the other observation channels.

- [ ] **Step 2: `docs/ipc-api.md`**

Add a section (or extend the existing observations section):

````
### `observations:restore`

Restores an observation's fields to a prior state without auto-stamping classification metadata. Used only by the undo system — direct user edits go through `update-bbox` or `update-classification`.

**Args:** `(studyId: string, observationID: string, fields: Record<string, any>)`

**Returns:** `{ data: <restored observation row> }` or `{ error: string }`

**Throws:** `Observation not found: <id>` when 0 rows match (so externally deleted targets trigger the caller's failure path).

### `observations:create` (extended)

Now accepts optional `observationID` and `eventID` in `observationData`. When provided, the supplied UUIDs are used instead of generating new ones — used by undo-of-delete to recreate the observation with its original IDs. Existing callers don't need to pass these fields; the auto-generation behavior is unchanged.
````

- [ ] **Step 3: `docs/database-schema.md`**

Add (or extend the observations section):

```
**Note on observationID reuse:** `observationID` is a TEXT primary key (UUID, not auto-increment). Once an observation is deleted, its UUID is freed and can be reused by a subsequent INSERT. The undo system relies on this: undoing a delete recreates the row with its original `observationID` and `eventID` so any later stack entries that reference it remain valid. The PK UNIQUE constraint still rejects double-inserts of a live UUID.
```

- [ ] **Step 4: Commit**

```
git add docs/architecture.md docs/ipc-api.md docs/database-schema.md
git commit -m "docs: undo/redo system + restoreObservation IPC"
```

---

## Final sanity sweep

- [ ] **Step 1: Run the full test suite**

```
npm test
```

Expected: all green. The new tests in `test/main/database/createObservationExplicitIds.test.js`, `test/main/database/restoreObservation.test.js`, `test/renderer/undo/UndoManager.test.js`, `test/renderer/undo/commands.test.js` should all pass alongside existing tests.

- [ ] **Step 2: Lint + format**

```
npm run lint
npm run format:check
```

Fix anything flagged (`npm run fix`, `npm run format`).

- [ ] **Step 3: Manual smoke pass — full workflow**

In a fresh study:

1. Draw a new bbox → `Cmd+Z` → bbox vanishes → `Cmd+Shift+Z` → bbox returns.
2. Change a species → `Cmd+Z` → reverts to original (including `classificationMethod` if it was machine-classified) → `Cmd+Shift+Z` → reapplies.
3. Delete a bbox → navigate to a different image → `Cmd+Z` → modal jumps back, bbox reappears with original UUID and event ID.
4. Drag a bbox → arrow-key nudge it 5 times → `Cmd+Z` 6 times → all reverted.
5. Make 105 edits → confirm only 100 are undoable.
6. Click into species text input, type, hit `Cmd+Z` → native text undo (not bbox undo).
7. Edit, then click some non-undoable mutation that breaks the entry (or simulate via temp throw) → toast appears, stack entry dropped.

- [ ] **Step 4: Final commit (if any fixes)**

```
git add -A
git commit -m "chore: lint + smoke fixes for undo system"
```

---

## Out of scope (per the spec)

- Coalescing rapid same-target edits (e.g., arrow-key nudges) — each press is its own entry in v1.
- Restoring pre-undo modal position on redo.
- Persisting the stack across app restarts.
- Tracking ML inference, imports, or other batch operations.
- A title-bar undo/redo button or "next action" indicator.
