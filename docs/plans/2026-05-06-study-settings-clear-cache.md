# Study Settings — Clear Cache Section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Cache" section to per-study Settings that shows total cache disk usage with an expandable breakdown (transcodes, thumbnails, images, videos) and a single "Clear" button that wipes the study's `cache/` directory.

**Architecture:** Five thin pieces glued together:
1. New service `src/main/services/cache/study.js` exposing `getStudyCacheStats(studyId)` and `clearStudyCache(studyId)`. Pure `*Impl` variants take a `studiesPath` argument and have no Electron dependency, so they're testable under `node --test`.
2. Two new IPC handlers — `study:get-cache-stats`, `study:clear-cache` — registered in `src/main/ipc/study.js`.
3. Preload bridge: `getStudyCacheStats(studyId)`, `clearStudyCache(studyId)`.
4. New React component `CacheSection.jsx` mounted between Export and Danger Zone in `StudySettings.jsx`. Uses `useQuery` for stats, refetches after clear.
5. Shared `formatBytes` util lifted out of `SettingsInfo/StorageBreakdown.jsx`.

**Tech Stack:** Electron IPC, Node `fs.promises`, React + TanStack Query (`useQuery`), Tailwind, lucide-react icons. Tests use `node --test` with a temp dir under `os.tmpdir()`, matching the pattern in `test/main/services/cache/cleanup.test.js`.

**Spec:** `docs/specs/2026-05-06-study-settings-clear-cache-design.md` (read this first; this plan implements it verbatim).

---

## File Structure

**Create:**
- `src/main/services/cache/study.js` — `getStudyCacheStats`, `clearStudyCache`, plus pure `*Impl` variants.
- `test/main/services/cache/study.test.js` — unit tests for the two `*Impl` functions.
- `src/renderer/src/utils/formatBytes.js` — shared bytes formatter (lifted from `StorageBreakdown.jsx`).
- `src/renderer/src/CacheSection.jsx` — new React section.

**Modify:**
- `src/main/services/cache/index.js` — re-export the two new functions.
- `src/main/ipc/study.js` — register `study:get-cache-stats` and `study:clear-cache`.
- `src/preload/index.js` — expose `getStudyCacheStats(studyId)` and `clearStudyCache(studyId)`.
- `src/renderer/src/StudySettings.jsx` — import and mount `<CacheSection />` between Export and Danger Zone.
- `src/renderer/src/SettingsInfo/StorageBreakdown.jsx` — replace inline `formatBytes` with shared import.
- `docs/ipc-api.md` — document the two new handlers.

No schema changes. No migrations. No new npm dependencies.

---

## Task 1: Pure cache-stats impl + tests

**Files:**
- Test: `test/main/services/cache/study.test.js` (create)
- Create: `src/main/services/cache/study.js`

The pure `getStudyCacheStatsImpl(studiesPath, studyId)` walks `<studiesPath>/<studyId>/cache/`, classifies immediate child directories into the four known cache subtypes, and returns `{ total, breakdown }`. Files in `cache/` that don't fall under one of the four known buckets are counted toward `total` only. Missing cache dir returns all zeros (no throw).

- [ ] **Step 1: Write the failing tests**

Create `test/main/services/cache/study.test.js` with this exact content. The structure mirrors `test/main/services/cache/cleanup.test.js` (same temp-dir pattern, same `electron-log` silencer).

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import fs from 'fs/promises'

import {
  getStudyCacheStatsImpl,
  clearStudyCacheImpl
} from '../../../../src/main/services/cache/study.js'

let testStudiesPath

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    // ok
  }
  testStudiesPath = join(tmpdir(), 'biowatch-cache-study-test', Date.now().toString())
  mkdirSync(testStudiesPath, { recursive: true })
})

afterEach(() => {
  if (existsSync(testStudiesPath)) {
    rmSync(testStudiesPath, { recursive: true, force: true })
  }
})

/**
 * Write `count` files of `sizeBytes` each into <studiesPath>/<studyId>/cache/<subdir>/.
 */
async function seedSubdir(studyId, subdir, count, sizeBytes) {
  const dir = join(testStudiesPath, studyId, 'cache', subdir)
  await fs.mkdir(dir, { recursive: true })
  for (let i = 0; i < count; i++) {
    await fs.writeFile(join(dir, `f${i}`), Buffer.alloc(sizeBytes))
  }
}

describe('getStudyCacheStatsImpl', () => {
  test('returns all zeros when cache dir does not exist', async () => {
    await fs.mkdir(join(testStudiesPath, 'study-1'), { recursive: true })

    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.deepEqual(result.total, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.transcodes, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.thumbnails, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.images, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.videos, { bytes: 0, files: 0 })
  })

  test('returns all zeros when cache dir is empty', async () => {
    await fs.mkdir(join(testStudiesPath, 'study-1', 'cache'), { recursive: true })

    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.equal(result.total.bytes, 0)
    assert.equal(result.total.files, 0)
  })

  test('aggregates bytes and files across all four subtypes', async () => {
    await seedSubdir('study-1', 'transcodes', 2, 1024) // 2 files × 1 KB
    await seedSubdir('study-1', 'thumbnails', 3, 512) // 3 files × 0.5 KB
    await seedSubdir('study-1', 'images', 4, 256) // 4 files × 0.25 KB
    await seedSubdir('study-1', 'videos', 1, 2048) // 1 file × 2 KB

    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.deepEqual(result.breakdown.transcodes, { bytes: 2048, files: 2 })
    assert.deepEqual(result.breakdown.thumbnails, { bytes: 1536, files: 3 })
    assert.deepEqual(result.breakdown.images, { bytes: 1024, files: 4 })
    assert.deepEqual(result.breakdown.videos, { bytes: 2048, files: 1 })
    assert.equal(result.total.bytes, 2048 + 1536 + 1024 + 2048)
    assert.equal(result.total.files, 10)
  })

  test('counts unknown cache subdirs in total but not in any breakdown bucket', async () => {
    await seedSubdir('study-1', 'transcodes', 1, 1000)
    await seedSubdir('study-1', 'future-cache-type', 2, 500) // 2 × 500 B = 1000 B

    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.deepEqual(result.breakdown.transcodes, { bytes: 1000, files: 1 })
    assert.deepEqual(result.breakdown.thumbnails, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.images, { bytes: 0, files: 0 })
    assert.deepEqual(result.breakdown.videos, { bytes: 0, files: 0 })
    assert.equal(result.total.bytes, 2000, 'total includes the unknown subdir')
    assert.equal(result.total.files, 3)
  })

  test('walks nested directories inside a cache subtype', async () => {
    const nested = join(testStudiesPath, 'study-1', 'cache', 'transcodes', 'sub')
    await fs.mkdir(nested, { recursive: true })
    await fs.writeFile(join(nested, 'a.mp4'), Buffer.alloc(800))
    await fs.writeFile(
      join(testStudiesPath, 'study-1', 'cache', 'transcodes', 'b.mp4'),
      Buffer.alloc(200)
    )

    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.deepEqual(result.breakdown.transcodes, { bytes: 1000, files: 2 })
  })
})

describe('clearStudyCacheImpl', () => {
  test('returns zeros when cache dir does not exist', async () => {
    await fs.mkdir(join(testStudiesPath, 'study-1'), { recursive: true })

    const result = await clearStudyCacheImpl(testStudiesPath, 'study-1')

    assert.equal(result.freedBytes, 0)
    assert.equal(result.clearedFiles, 0)
    assert.equal(result.error, undefined)
  })

  test('removes cache dir and returns matching freed totals', async () => {
    await seedSubdir('study-1', 'transcodes', 2, 1000)
    await seedSubdir('study-1', 'images', 3, 500)

    const result = await clearStudyCacheImpl(testStudiesPath, 'study-1')

    assert.equal(result.freedBytes, 2 * 1000 + 3 * 500)
    assert.equal(result.clearedFiles, 5)
    assert.equal(
      existsSync(join(testStudiesPath, 'study-1', 'cache')),
      false,
      'cache dir is removed'
    )
  })

  test('subsequent stats call returns zeros after clear', async () => {
    await seedSubdir('study-1', 'transcodes', 2, 1000)

    await clearStudyCacheImpl(testStudiesPath, 'study-1')
    const result = await getStudyCacheStatsImpl(testStudiesPath, 'study-1')

    assert.equal(result.total.bytes, 0)
    assert.equal(result.total.files, 0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="getStudyCacheStatsImpl|clearStudyCacheImpl"`
Expected: FAIL — module `src/main/services/cache/study.js` doesn't exist yet (`Cannot find module …/study.js`).

If `npm test` rebuilds native modules and is slow, run the file directly: `node --test test/main/services/cache/study.test.js` — same expected error.

- [ ] **Step 3: Implement `src/main/services/cache/study.js`**

Create `src/main/services/cache/study.js` with this exact content:

```js
/**
 * Per-study cache stats and clearing.
 *
 * Aggregates disk usage across the four known cache subdirectories
 * (transcodes, thumbnails, images, videos) under
 * <userData>/biowatch-data/studies/<studyId>/cache/, and clears the
 * whole cache directory in one call. Pure *Impl variants take the
 * studies root as a parameter so they are testable without Electron.
 */

import { readdir, stat, rm } from 'fs/promises'
import { join } from 'path'

import { getBiowatchDataPath } from '../paths.js'

const KNOWN_SUBTYPES = ['transcodes', 'thumbnails', 'images', 'videos']

/**
 * Recursively sum bytes and file count under a directory.
 * Missing dir → zeros, no throw. Unreadable entry → skipped.
 *
 * @param {string} dir
 * @returns {Promise<{ bytes: number, files: number }>}
 */
async function dirStats(dir) {
  let bytes = 0
  let files = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return { bytes: 0, files: 0 }
    return { bytes: 0, files: 0 }
  }
  await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          const sub = await dirStats(full)
          bytes += sub.bytes
          files += sub.files
        } else if (entry.isFile()) {
          const st = await stat(full)
          bytes += st.size
          files += 1
        }
      } catch {
        // unreadable — skip
      }
    })
  )
  return { bytes, files }
}

/**
 * Pure variant — testable without Electron.
 *
 * @param {string} studiesPath - absolute path to <biowatch-data>/studies
 * @param {string} studyId
 * @returns {Promise<{
 *   total: { bytes: number, files: number },
 *   breakdown: {
 *     transcodes: { bytes: number, files: number },
 *     thumbnails: { bytes: number, files: number },
 *     images:     { bytes: number, files: number },
 *     videos:     { bytes: number, files: number }
 *   }
 * }>}
 */
export async function getStudyCacheStatsImpl(studiesPath, studyId) {
  const cacheDir = join(studiesPath, studyId, 'cache')

  const breakdown = {
    transcodes: { bytes: 0, files: 0 },
    thumbnails: { bytes: 0, files: 0 },
    images: { bytes: 0, files: 0 },
    videos: { bytes: 0, files: 0 }
  }

  let entries
  try {
    entries = await readdir(cacheDir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { total: { bytes: 0, files: 0 }, breakdown }
    }
    throw err
  }

  // Walk the whole cache dir for total, and each known subdir for breakdown.
  // Files at the root of cache/ count toward total but not any breakdown bucket.
  const total = await dirStats(cacheDir)

  await Promise.all(
    KNOWN_SUBTYPES.map(async (name) => {
      const sub = entries.find((e) => e.isDirectory() && e.name === name)
      if (!sub) return
      breakdown[name] = await dirStats(join(cacheDir, name))
    })
  )

  return { total, breakdown }
}

/**
 * Pure variant — testable without Electron.
 *
 * @param {string} studiesPath
 * @param {string} studyId
 * @returns {Promise<{ freedBytes: number, clearedFiles: number, error?: string }>}
 */
export async function clearStudyCacheImpl(studiesPath, studyId) {
  const cacheDir = join(studiesPath, studyId, 'cache')

  // Capture totals first so we can report what was removed.
  const { total } = await getStudyCacheStatsImpl(studiesPath, studyId)

  if (total.files === 0 && total.bytes === 0) {
    // Nothing to clear (or cache dir doesn't exist). Don't bother calling rm.
    return { freedBytes: 0, clearedFiles: 0 }
  }

  try {
    await rm(cacheDir, { recursive: true, force: true })
    return { freedBytes: total.bytes, clearedFiles: total.files }
  } catch (e) {
    return { freedBytes: 0, clearedFiles: 0, error: e.message }
  }
}

/**
 * Electron-aware wrapper. Resolves the studies root via getBiowatchDataPath().
 */
export async function getStudyCacheStats(studyId) {
  const studiesPath = join(getBiowatchDataPath(), 'studies')
  return await getStudyCacheStatsImpl(studiesPath, studyId)
}

/**
 * Electron-aware wrapper. Resolves the studies root via getBiowatchDataPath().
 */
export async function clearStudyCache(studyId) {
  const studiesPath = join(getBiowatchDataPath(), 'studies')
  return await clearStudyCacheImpl(studiesPath, studyId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/main/services/cache/study.test.js`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/cache/study.js test/main/services/cache/study.test.js
git commit -m "feat(cache): add per-study cache stats and clear service"
```

---

## Task 2: Re-export from cache index

**Files:**
- Modify: `src/main/services/cache/index.js`

The cache services barrel re-exports each cache module. Keep the new study-level functions reachable from `services/cache/index.js` for consistency.

- [ ] **Step 1: Add the re-export**

Append the following block to `src/main/services/cache/index.js` (after the existing image-caching block, before the cleanup block):

```js
// Per-study cache aggregation
export {
  getStudyCacheStats,
  clearStudyCache,
  getStudyCacheStatsImpl,
  clearStudyCacheImpl
} from './study.js'
```

- [ ] **Step 2: Verify the import resolves**

Run: `node -e "import('./src/main/services/cache/index.js').then(m => console.log(typeof m.getStudyCacheStats, typeof m.clearStudyCache)).catch(e => { console.error(e); process.exit(1) })"`
Expected: `function function`

- [ ] **Step 3: Commit**

```bash
git add src/main/services/cache/index.js
git commit -m "chore(cache): re-export study cache helpers from barrel"
```

---

## Task 3: IPC handlers

**Files:**
- Modify: `src/main/ipc/study.js`

Two new handlers, mirroring the error-shape convention used by neighbours (`study:has-event-ids`, `study:get-sequence-gap`): return `{ data }` on success, `{ error: message }` on failure.

- [ ] **Step 1: Add the imports**

In `src/main/ipc/study.js`, change the existing import block to add the new functions. Replace:

```js
import { listStudies, updateStudy } from '../services/study.js'
```

with:

```js
import { listStudies, updateStudy } from '../services/study.js'
import { getStudyCacheStats, clearStudyCache } from '../services/cache/study.js'
```

- [ ] **Step 2: Register the two new handlers**

In `src/main/ipc/study.js`, inside `registerStudyIPCHandlers()`, after the existing `study:set-sequence-gap` handler (line 104) and before the closing `}` of the function, append:

```js
  ipcMain.handle('study:get-cache-stats', async (_, studyId) => {
    try {
      const data = await getStudyCacheStats(studyId)
      return { data }
    } catch (error) {
      log.error('Error getting study cache stats:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('study:clear-cache', async (_, studyId) => {
    try {
      const data = await clearStudyCache(studyId)
      return { data }
    } catch (error) {
      log.error('Error clearing study cache:', error)
      return { error: error.message }
    }
  })
```

- [ ] **Step 3: Verify the file parses**

Run: `node --check src/main/ipc/study.js`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/study.js
git commit -m "feat(ipc): add study:get-cache-stats and study:clear-cache handlers"
```

---

## Task 4: Preload bridge

**Files:**
- Modify: `src/preload/index.js`

Expose the two new IPC channels on `window.api` for the renderer. Both unwrap the `{ data, error }` envelope and throw on error so `useQuery` can surface failures naturally.

- [ ] **Step 1: Add the two API methods**

In `src/preload/index.js`, locate the line `setSequenceGap: async (studyId, sequenceGap) => {` (around line 57). Immediately after the closing `},` of `setSequenceGap` (around line 59) and before `getLocationsActivity:`, insert:

```js
  getStudyCacheStats: async (studyId) => {
    const response = await electronAPI.ipcRenderer.invoke('study:get-cache-stats', studyId)
    if (response.error) throw new Error(response.error)
    return response.data
  },
  clearStudyCache: async (studyId) => {
    const response = await electronAPI.ipcRenderer.invoke('study:clear-cache', studyId)
    if (response.error) throw new Error(response.error)
    return response.data
  },
```

- [ ] **Step 2: Verify the file parses**

Run: `node --check src/preload/index.js`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.js
git commit -m "feat(preload): expose getStudyCacheStats and clearStudyCache"
```

---

## Task 5: Lift `formatBytes` to shared util

**Files:**
- Create: `src/renderer/src/utils/formatBytes.js`
- Modify: `src/renderer/src/SettingsInfo/StorageBreakdown.jsx`

`StorageBreakdown.jsx` defines `formatBytes` inline. We need the same formatter in `CacheSection.jsx`. Lift it to a shared util now so both files import the same canonical implementation.

- [ ] **Step 1: Create the shared util**

Create `src/renderer/src/utils/formatBytes.js`:

```js
/**
 * Format a byte count as a human-readable string.
 *
 * Examples:
 *   formatBytes(0)           // "0 B"
 *   formatBytes(512)         // "512 B"
 *   formatBytes(1536)        // "1.5 KB"
 *   formatBytes(260 * 1024 * 1024) // "260 MB"
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`
}
```

- [ ] **Step 2: Replace the inline copy in `StorageBreakdown.jsx`**

In `src/renderer/src/SettingsInfo/StorageBreakdown.jsx`, replace the existing inline `formatBytes` block (lines 4–14) with an import. The import sits at the top of the file, after the existing imports.

Before (top of file):
```jsx
import { useQuery } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`
}
```

After:
```jsx
import { useQuery } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'

import { formatBytes } from '../utils/formatBytes.js'
```

The rest of the file stays identical — `formatBytes` calls inside `StorageRow` continue to work.

- [ ] **Step 3: Verify both files parse**

Run: `npm run lint -- src/renderer/src/utils/formatBytes.js src/renderer/src/SettingsInfo/StorageBreakdown.jsx`
Expected: clean (or only pre-existing warnings unrelated to these files).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/utils/formatBytes.js src/renderer/src/SettingsInfo/StorageBreakdown.jsx
git commit -m "refactor(renderer): lift formatBytes to shared utils"
```

---

## Task 6: `CacheSection` component

**Files:**
- Create: `src/renderer/src/CacheSection.jsx`

Self-contained section. Fetches `getStudyCacheStats` via `useQuery`. Clear button calls `clearStudyCache` and refetches. Tracks an inline `lastResult` (success or error) shown next to the button until unmount or until the user clicks Clear again. Breakdown is collapsed by default behind a "Show breakdown" / "Hide breakdown" toggle. When `total.bytes === 0`, the breakdown toggle is hidden and the button is disabled.

- [ ] **Step 1: Create the component**

Create `src/renderer/src/CacheSection.jsx` with this exact content:

```jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

import { formatBytes } from './utils/formatBytes.js'

const BREAKDOWN_LABELS = {
  transcodes: 'Transcoded videos',
  thumbnails: 'Video thumbnails',
  images: 'Remote images',
  videos: 'Source videos'
}

function formatRow(entry) {
  if (!entry) return '— · — files'
  return `${formatBytes(entry.bytes)} · ${entry.files.toLocaleString()} files`
}

export default function CacheSection({ studyId }) {
  const [clearing, setClearing] = useState(false)
  const [lastResult, setLastResult] = useState(null) // { freedBytes, clearedFiles } | { error } | null
  const [expanded, setExpanded] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['study-cache-stats', studyId],
    queryFn: () => window.api.getStudyCacheStats(studyId)
  })

  const total = data?.total ?? { bytes: 0, files: 0 }
  const breakdown = data?.breakdown
  const isEmpty = !isLoading && total.bytes === 0 && total.files === 0

  const handleClear = async () => {
    setClearing(true)
    setLastResult(null)
    try {
      const result = await window.api.clearStudyCache(studyId)
      setLastResult(result)
      await refetch()
    } catch (e) {
      setLastResult({ error: e.message })
    } finally {
      setClearing(false)
    }
  }

  return (
    <section className="py-6">
      <h2 className="text-base font-medium text-gray-900 mb-1">Cache</h2>
      <p className="text-sm text-gray-500 mb-4">
        Cached transcoded videos, thumbnails, and remote images. Cleared files are regenerated
        automatically when needed.
      </p>

      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-gray-700">Total used</span>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-gray-900">
            {isLoading ? '…' : formatRow(total)}
          </span>
          <button
            onClick={handleClear}
            disabled={isLoading || isEmpty || clearing}
            className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {clearing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Clearing…
              </>
            ) : (
              'Clear'
            )}
          </button>
        </div>
      </div>

      {lastResult?.error && (
        <p className="text-sm text-red-600 mt-1">Failed to clear cache: {lastResult.error}</p>
      )}
      {lastResult && !lastResult.error && (
        <p className="text-sm text-green-700 mt-1">
          Cleared {formatBytes(lastResult.freedBytes)} · {lastResult.clearedFiles.toLocaleString()}{' '}
          files
        </p>
      )}

      {!isEmpty && !isLoading && (
        <button
          onClick={() => setExpanded((v) => !v)}
          disabled={clearing}
          className="cursor-pointer flex items-center gap-1 mt-3 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {expanded ? 'Hide breakdown' : 'Show breakdown'}
        </button>
      )}

      {expanded && breakdown && (
        <div className="mt-2 pl-5 divide-y divide-gray-100">
          {Object.keys(BREAKDOWN_LABELS).map((key) => (
            <div key={key} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-gray-700">{BREAKDOWN_LABELS[key]}</span>
              <span className="text-sm tabular-nums text-gray-900">
                {formatRow(breakdown[key])}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Verify the component parses**

Run: `npm run lint -- src/renderer/src/CacheSection.jsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/CacheSection.jsx
git commit -m "feat(renderer): add CacheSection component"
```

---

## Task 7: Mount `CacheSection` in `StudySettings`

**Files:**
- Modify: `src/renderer/src/StudySettings.jsx`

Drop a `<CacheSection />` between the Export `<section>` and the Danger Zone `<section>`. Both already sit inside the `divide-y` wrapper, so the new section's `<section className="py-6">` will pick up the divider for free.

- [ ] **Step 1: Add the import**

In `src/renderer/src/StudySettings.jsx`, replace the existing import block (lines 1–7):

```jsx
import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import DeleteStudyModal from './DeleteStudyModal'
import Export from './export'
import { useSequenceGap } from './hooks/useSequenceGap'
import { SequenceGapSlider } from './ui/SequenceGapSlider'
```

with:

```jsx
import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import CacheSection from './CacheSection'
import DeleteStudyModal from './DeleteStudyModal'
import Export from './export'
import { useSequenceGap } from './hooks/useSequenceGap'
import { SequenceGapSlider } from './ui/SequenceGapSlider'
```

- [ ] **Step 2: Mount the new section**

In `src/renderer/src/StudySettings.jsx`, locate the closing `</section>` of the Export block (line 76) and the opening `<section className="py-6">` of the Danger Zone block (line 78). Between them, insert:

```jsx
        <CacheSection studyId={studyId} />

```

After the change, that part of the file should read:

```jsx
        <section className="py-6">
          <h2 className="text-base font-medium text-gray-900 mb-1">Export</h2>
          <p className="text-sm text-gray-500 mb-4">
            Export this study&apos;s data in standard formats.
          </p>
          <Export studyId={studyId} />
        </section>

        <CacheSection studyId={studyId} />

        <section className="py-6">
          <h2 className="text-base font-medium text-red-700 mb-4">Danger Zone</h2>
```

- [ ] **Step 3: Verify the file parses**

Run: `npm run lint -- src/renderer/src/StudySettings.jsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/StudySettings.jsx
git commit -m "feat(study-settings): mount CacheSection between Export and Danger Zone"
```

---

## Task 8: Document the new IPC handlers

**Files:**
- Modify: `docs/ipc-api.md`

Document `study:get-cache-stats` and `study:clear-cache` in the same Studies section that already documents `study:delete-database`, `study:has-event-ids`, etc.

- [ ] **Step 1: Locate the Studies section**

Run: `grep -n "study:set-sequence-gap\|study:delete-database" docs/ipc-api.md`
Note the line numbers — the new entries go at the end of the Studies section, after `study:set-sequence-gap` if present (or after the last `study:` handler).

- [ ] **Step 2: Add the two new entries**

After the last existing `study:*` entry in `docs/ipc-api.md`, append:

````markdown
### `study:get-cache-stats`

Returns disk usage for a study's cache directory
(`<userData>/biowatch-data/studies/<studyId>/cache/`), broken down by
the four known cache subtypes.

**Args:** `(studyId: string)`

**Returns:**
```js
{
  data: {
    total: { bytes: number, files: number },
    breakdown: {
      transcodes: { bytes: number, files: number }, // <cache>/transcodes/
      thumbnails: { bytes: number, files: number }, // <cache>/thumbnails/
      images:     { bytes: number, files: number }, // <cache>/images/
      videos:     { bytes: number, files: number }  // <cache>/videos/
    }
  }
}
// or { error: string }
```

Files in `cache/` that don't fall under one of the four known subdirs
are counted toward `total` only, not in any breakdown bucket. Missing
cache directory returns all zeros.

### `study:clear-cache`

Removes the study's entire `cache/` directory. The four cache
subdirectories are recreated lazily on next write by the per-cache
services (`cache/video.js`, `cache/image.js`).

**Args:** `(studyId: string)`

**Returns:**
```js
{ data: { freedBytes: number, clearedFiles: number, error?: string } }
// or { error: string }
```

The inner `error` field (inside `data`) is set when `rm` failed
mid-clear; the outer envelope's `error` covers exceptions thrown
before that point.
````

- [ ] **Step 3: Commit**

```bash
git add docs/ipc-api.md
git commit -m "docs(ipc): document study cache stats and clear handlers"
```

---

## Task 9: Manual smoke verification

The renderer surface isn't covered by automated tests; verify it manually before considering the feature done.

- [ ] **Step 1: Boot the dev app**

Run: `npm run dev`
Expected: app window opens.

- [ ] **Step 2: Open a study with cache content**

Pick a study that has played at least one video (so `transcodes/` and `thumbnails/` are populated) and/or imported GBIF data (so `images/` is populated). If no such study exists, play any video in any study to populate the cache.

Open Settings for that study (gear icon on the study row → Settings, or whichever path the app uses).

- [ ] **Step 3: Verify the Cache section renders**

Expected:
- "Cache" header sits between "Export" and "Danger Zone".
- "Total used" row shows a non-zero size and file count.
- "Clear" button is enabled.
- "Show breakdown" toggle is visible.

- [ ] **Step 4: Expand the breakdown**

Click "Show breakdown".

Expected: Four rows render — Transcoded videos, Video thumbnails, Remote images, Source videos — with their individual sizes. Subtypes that are empty for this study show "0 B · 0 files".

- [ ] **Step 5: Click Clear**

Expected:
- Button label changes to "Clearing…" with a spinner; button and breakdown toggle disabled.
- After completion (typically <1s for small caches, longer for GB-scale): green "Cleared X · Y files" appears below the row.
- "Total used" refreshes to "0 B · 0 files".
- Breakdown toggle disappears.
- Button becomes disabled.

- [ ] **Step 6: Verify the cache directory is gone**

Run (replacing `<studyId>`):
```bash
ls "$(node -e 'console.log(require("electron").app.getPath("userData"))' 2>/dev/null || echo "$HOME/.config/biowatch")/biowatch-data/studies/<studyId>/cache" 2>&1
```

Expected: `No such file or directory` (the cache dir was removed and not recreated).

If the path resolution above is awkward, just open Settings → Info → Storage and confirm the "Studies" total dropped by roughly the size that was just cleared.

- [ ] **Step 7: Use the app to regenerate cache**

Play a video in the same study.

Expected: video plays normally. The `cache/transcodes/` and `cache/thumbnails/` subdirs are recreated lazily by `ensureCacheDir` / `ensureThumbnailCacheDir` in `cache/video.js`.

- [ ] **Step 8: Empty-cache state**

Open Settings for a brand-new study (or one whose cache you just cleared and haven't touched). Without playing any video:

Expected:
- "Total used" shows "0 B · 0 files" in muted color.
- "Clear" button is disabled.
- "Show breakdown" toggle is hidden.

- [ ] **Step 9: Re-run unit tests one more time**

Run: `node --test test/main/services/cache/study.test.js`
Expected: all 8 tests still PASS.

- [ ] **Step 10: Final lint + format check**

Run: `npm run lint && npm run format:check`
Expected: clean.

- [ ] **Step 11: No commit needed for verification**

Manual smoke verification produces no code changes. If any tweaks were required during smoke testing, they should have been committed under their respective task above.

---

## Self-review checklist (already run by author)

**Spec coverage:**
- Cache section between Export and Danger Zone — Task 7 ✓
- Total + Clear button + breakdown toggle — Task 6 ✓
- No confirmation modal — Task 6 (`handleClear` calls clear directly) ✓
- Inline result message — Task 6 (`lastResult` rendering) ✓
- One read IPC + one write IPC — Tasks 3, 4 ✓
- `getStudyCacheStats` shape (total + breakdown of 4 subtypes) — Task 1 (impl) + Task 8 (docs) ✓
- `clearStudyCache` returns `{ freedBytes, clearedFiles, error? }` — Task 1 ✓
- Pure `*Impl` variants for testing — Task 1 ✓
- Tests cover: missing dir, empty dir, populated subdirs, unknown subdir, post-clear stats — Task 1 ✓
- `formatBytes` lifted to shared util — Task 5 ✓
- New file paths match spec (`utils/formatBytes.js`, `CacheSection.jsx`, `cache/study.js`) ✓
- Re-export from `cache/index.js` — Task 2 ✓
- Docs update — Task 8 ✓

**Placeholder scan:** No "TBD" or "fill in" lines. All code blocks contain runnable code; all commands have explicit expected output.

**Type consistency:**
- `getStudyCacheStatsImpl` and `getStudyCacheStats` return the same shape ({ total, breakdown }) ✓
- `clearStudyCacheImpl` and `clearStudyCache` return the same shape ({ freedBytes, clearedFiles, error? }) ✓
- Preload unwraps `{ data, error }` envelope; renderer consumes raw payload ✓
- `BREAKDOWN_LABELS` keys match the four subtype names used in the impl ✓
