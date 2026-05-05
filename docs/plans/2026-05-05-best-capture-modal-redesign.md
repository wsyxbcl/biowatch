# Best-Capture Modal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the two best-capture modals (`ImageViewerModal` and `VideoViewerModal` in `BestMediaCarousel.jsx`) to add a deployment-link pill, move the filename to footer-left, and float the species heading as an overlay at top-center of the media area.

**Architecture:** Five layers — (1) extend the best-media SQL queries to LEFT JOIN `deployments` and project `locationID`/`locationName` per row, (2) extract the existing `DeploymentLinkPill` from `Gallery.jsx` into a shared module, (3) add a `tone` prop to `SpeciesHeading` for dark-background rendering, (4) edit `ImageViewerModal` JSX (image-area overlay + footer rewrite + pill render), (5) same JSX edits for `VideoViewerModal`.

**Tech Stack:** Raw SQL (better-sqlite3), React, react-router (`useNavigate`), lucide-react (`MapPin`), `node:test` for backend tests.

**Spec:** `docs/specs/2026-05-05-best-capture-modal-redesign-design.md`

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/main/database/queries/best-media.js` | Modify | Two raw-SQL queries (favorites CTE + auto-scored CTE) get a LEFT JOIN on `deployments` and project `locationID`/`locationName`. |
| `test/main/database/queries.test.js` | Modify | Add a test that marks a media as favorite, calls `getBestMedia`, and asserts the returned row carries the expected location fields. |
| `src/renderer/src/media/DeploymentLinkPill.jsx` | Create | New file — the `DeploymentLinkPill` component, moved verbatim from `Gallery.jsx`. |
| `src/renderer/src/media/Gallery.jsx` | Modify | Remove the inline `DeploymentLinkPill` definition; import from the new shared module. Drop `useNavigate` from the file's imports if no other use exists in this file (it doesn't). |
| `src/renderer/src/ui/BestMediaCarousel.jsx` | Modify | (a) Add `tone` prop to `SpeciesHeading`. (b) Insert species overlay in `ImageViewerModal`'s image area. (c) Rewrite `ImageViewerModal`'s footer (filename left, pill right). (d) Same overlay + footer changes in `VideoViewerModal`. (e) Import `DeploymentLinkPill` from the shared module. |

No other files touched.

---

## Task 1: Backend — Failing test for `locationID` / `locationName` in `getBestMedia` results

**Files:**
- Modify: `test/main/database/queries.test.js`

The existing `createTestData` helper inserts `media001` on `deploy001` (locationID `loc001`, locationName `Forest Site A`) with a real Cervus elaphus observation. We mark it as a favorite via the existing `updateMediaFavorite` export, then call `getBestMedia`.

- [ ] **Step 1: Add the imports**

At the top of `test/main/database/queries.test.js` the import list (line 9-22) currently ends with `getMediaForSequencePagination`. Extend it to include `getBestMedia` and `updateMediaFavorite`. Change:

```js
import {
  getSpeciesDistribution,
  getLocationsActivity,
  getDeploymentLocations,
  getDeploymentsActivity,
  getFilesData,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations,
  getStudyIdFromPath,
  getBlankMediaCount,
  getMediaForSequencePagination
} from '../../../src/main/database/index.js'
```

to:

```js
import {
  getSpeciesDistribution,
  getLocationsActivity,
  getDeploymentLocations,
  getDeploymentsActivity,
  getFilesData,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations,
  getStudyIdFromPath,
  getBlankMediaCount,
  getMediaForSequencePagination,
  getBestMedia,
  updateMediaFavorite
} from '../../../src/main/database/index.js'
```

- [ ] **Step 2: Append a new `describe` block for `getBestMedia`**

Add a new top-level `describe` block at the end of the existing `describe('Database Query Functions Tests', …)` outer block — i.e., immediately before the file's closing `})` at line 808 of the post-Task-1 file.

```js
  describe('getBestMedia', () => {
    test('returns locationID and locationName for favorite media rows', async () => {
      await createTestData(testDbPath)

      // media001 is on deploy001 → loc001 / Forest Site A. Marking it as
      // a favorite makes it the only row that the favorites CTE can return,
      // and gives us a deterministic expected location.
      await updateMediaFavorite(testDbPath, 'media001', true)

      const result = await getBestMedia(testDbPath, { limit: 12 })

      const row = result.find((r) => r.mediaID === 'media001')
      assert.ok(row, 'should return media001')
      assert.equal(row.locationID, 'loc001', 'locationID should be loc001')
      assert.equal(row.locationName, 'Forest Site A', 'locationName should be Forest Site A')
    })
  })
```

- [ ] **Step 3: Run the failing test**

```bash
npm run test:rebuild && node --test --test-name-pattern="returns locationID and locationName for favorite media rows" test/main/database/queries.test.js
```

Expected: FAIL — assertion errors because `row.locationID` and `row.locationName` are `undefined` (the SQL doesn't yet project them).

- [ ] **Step 4: Commit the failing test**

```bash
git add test/main/database/queries.test.js
git commit -m "test(best-media): expect locationID/locationName in returned rows"
```

---

## Task 2: Backend — Extend the favorites CTE query

**Files:**
- Modify: `src/main/database/queries/best-media.js` (lines 277-337)

The favorites query has two changes: the `favs` CTE selects from `media` aliased as `m` and LEFT JOINs `deployments` aliased as `d`; the final `SELECT` carries the new fields through.

- [ ] **Step 1: Update the `favs` CTE**

Change:

```js
    const favoritesQuery = `
      WITH favs AS (
        SELECT
          mediaID, filePath, fileName, timestamp, deploymentID, fileMediatype, favorite
        FROM media
        WHERE favorite = 1
      ),
```

to:

```js
    const favoritesQuery = `
      WITH favs AS (
        SELECT
          m.mediaID, m.filePath, m.fileName, m.timestamp, m.deploymentID, m.fileMediatype, m.favorite,
          d.locationID, d.locationName
        FROM media m
        LEFT JOIN deployments d ON d.deploymentID = m.deploymentID
        WHERE m.favorite = 1
      ),
```

- [ ] **Step 2: Update the favorites query final `SELECT`**

The final SELECT (lines 314-321) currently is:

```js
      SELECT
        f.mediaID,
        f.filePath,
        f.fileName,
        f.timestamp,
        f.deploymentID,
        f.fileMediatype,
        f.favorite,
        COALESCE(o1.observationID, o2.observationID) as observationID,
```

Change to (add `f.locationID, f.locationName` between `f.deploymentID` and `f.fileMediatype`):

```js
      SELECT
        f.mediaID,
        f.filePath,
        f.fileName,
        f.timestamp,
        f.deploymentID,
        f.locationID,
        f.locationName,
        f.fileMediatype,
        f.favorite,
        COALESCE(o1.observationID, o2.observationID) as observationID,
```

- [ ] **Step 3: Run the test, verify it passes**

```bash
node --test --test-name-pattern="returns locationID and locationName for favorite media rows" test/main/database/queries.test.js
```

Expected: PASS.

- [ ] **Step 4: Run the full queries test suite for regressions**

```bash
node --test test/main/database/queries.test.js
```

Expected: every test passes (26 tests).

- [ ] **Step 5: Commit the favorites-CTE change**

```bash
git add src/main/database/queries/best-media.js
git commit -m "feat(best-media): include locationID/locationName in favorite rows"
```

---

## Task 3: Backend — Extend the auto-scored CTE query

**Files:**
- Modify: `src/main/database/queries/best-media.js` (lines 391-549)

This is the second SQL query in `getBestMedia`. Its final `SELECT` already does `INNER JOIN media m ON r.mediaID = m.mediaID`. We add a `LEFT JOIN deployments d ON d.deploymentID = m.deploymentID` and project the new fields.

- [ ] **Step 1: Update the auto-scored final `SELECT` and JOINs**

Change (lines 527-548):

```js
      SELECT
        m.mediaID,
        m.filePath,
        m.fileName,
        m.timestamp,
        m.deploymentID,
        m.fileMediatype,
        m.favorite,
        r.observationID,
        r.scientificName,
        r.bboxX,
        r.bboxY,
        r.bboxWidth,
        r.bboxHeight,
        r.detectionConfidence,
        r.classificationProbability,
        r.eventID,
        r.compositeScore
      FROM ranked_per_species r
      INNER JOIN media m ON r.mediaID = m.mediaID
      WHERE r.species_rank <= ?
      ORDER BY r.compositeScore DESC
    `
```

to:

```js
      SELECT
        m.mediaID,
        m.filePath,
        m.fileName,
        m.timestamp,
        m.deploymentID,
        d.locationID,
        d.locationName,
        m.fileMediatype,
        m.favorite,
        r.observationID,
        r.scientificName,
        r.bboxX,
        r.bboxY,
        r.bboxWidth,
        r.bboxHeight,
        r.detectionConfidence,
        r.classificationProbability,
        r.eventID,
        r.compositeScore
      FROM ranked_per_species r
      INNER JOIN media m ON r.mediaID = m.mediaID
      LEFT JOIN deployments d ON d.deploymentID = m.deploymentID
      WHERE r.species_rank <= ?
      ORDER BY r.compositeScore DESC
    `
```

- [ ] **Step 2: Run the queries test suite again**

```bash
node --test test/main/database/queries.test.js
```

Expected: all tests pass (the favorite-path assertion already exercises the `getBestMedia` entry point; the auto-scored path doesn't have a dedicated assertion but should not regress any other test).

- [ ] **Step 3: Run the full repo test suite for regressions**

```bash
npm test
```

Expected: every test passes.

- [ ] **Step 4: Commit**

```bash
git add src/main/database/queries/best-media.js
git commit -m "feat(best-media): include locationID/locationName in auto-scored rows"
```

---

## Task 4: Frontend — Extract `DeploymentLinkPill` into its own file

**Files:**
- Create: `src/renderer/src/media/DeploymentLinkPill.jsx`
- Modify: `src/renderer/src/media/Gallery.jsx`

Pure refactor. Move the component verbatim, then update the import.

- [ ] **Step 1: Create the new file**

Write the new file at `src/renderer/src/media/DeploymentLinkPill.jsx` with:

```jsx
import { ChevronRight, MapPin } from 'lucide-react'
import { useNavigate } from 'react-router'

/**
 * Footer pill in modal media viewers that navigates to the corresponding
 * deployment in the Deployments tab. When `interactive` is false, renders
 * the same label as a static span — context, not a link.
 *
 * Label fallback: locationName → locationID → 'View deployment'.
 */
export default function DeploymentLinkPill({
  studyId,
  deploymentID,
  locationName,
  locationID,
  interactive,
  onNavigate
}) {
  const navigate = useNavigate()
  const label = locationName || locationID || 'View deployment'

  if (!interactive) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
        <MapPin size={12} />
        <span className="truncate max-w-[200px]">{label}</span>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onNavigate?.()
        navigate(
          `/study/${encodeURIComponent(studyId)}/deployments?deploymentID=${encodeURIComponent(deploymentID)}`
        )
      }}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] text-gray-600 hover:text-blue-700 hover:bg-blue-50 transition-colors"
      title="Open in Deployments tab"
    >
      <MapPin size={12} />
      <span className="truncate max-w-[200px]">{label}</span>
      <ChevronRight size={12} />
    </button>
  )
}
```

- [ ] **Step 2: Remove the inline component from `Gallery.jsx`**

In `src/renderer/src/media/Gallery.jsx`, find the `DeploymentLinkPill` block that begins with the `/** Footer pill in ImageModal …` JSDoc and ends with the function's closing `}`. Delete the entire block (the JSDoc + the function body, ~50 lines).

- [ ] **Step 3: Add the import to `Gallery.jsx`**

Near the top of `Gallery.jsx`, alongside the other imports from `../ui/...` etc., add:

```js
import DeploymentLinkPill from './DeploymentLinkPill'
```

- [ ] **Step 4: Drop `useNavigate` from `Gallery.jsx`'s react-router import**

The `react-router` import line currently reads:

```js
import { useNavigate, useParams } from 'react-router'
```

`useNavigate` is no longer used inside `Gallery.jsx` once `DeploymentLinkPill` moves out. Change the line to:

```js
import { useParams } from 'react-router'
```

- [ ] **Step 5: Drop `MapPin` from `Gallery.jsx`'s lucide-react import**

The `lucide-react` import block ends with `Info, MapPin`. Since `MapPin` is no longer used in this file (only `DeploymentLinkPill` used it), drop it. Change:

```js
import {
  CameraOff,
  X,
  Calendar,
  Pencil,
  Check,
  Clock,
  Eye,
  EyeOff,
  Layers,
  Play,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Heart,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Info,
  MapPin
} from 'lucide-react'
```

to:

```js
import {
  CameraOff,
  X,
  Calendar,
  Pencil,
  Check,
  Clock,
  Eye,
  EyeOff,
  Layers,
  Play,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Heart,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Info
} from 'lucide-react'
```

(Note: `ChevronRight` is still imported because it's used elsewhere in `Gallery.jsx`; only `MapPin` and `useNavigate` go.)

- [ ] **Step 6: Lint — confirm no new warnings or errors**

```bash
npm run lint
```

Expected: no new errors. Pre-existing warnings remain.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/media/DeploymentLinkPill.jsx src/renderer/src/media/Gallery.jsx
git commit -m "refactor(media): extract DeploymentLinkPill into shared module"
```

---

## Task 5: Frontend — Add `tone` prop to `SpeciesHeading`

**Files:**
- Modify: `src/renderer/src/ui/BestMediaCarousel.jsx`, lines 31-44

`SpeciesHeading` is currently styled for light backgrounds. Best-capture modal overlays have a dark background, so the inner italic scientific name (`text-gray-500`) becomes unreadable. Add a `tone` prop with a `'dark'` variant that swaps the gray.

- [ ] **Step 1: Update the component**

Change:

```jsx
function SpeciesHeading({ scientificName }) {
  const common = useCommonName(scientificName)
  if (!scientificName) return <>Blank</>
  if (common && common !== scientificName) {
    return (
      <>
        {toTitleCase(common)}{' '}
        <span className="italic font-normal text-gray-500 text-sm">
          ({formatScientificName(scientificName)})
        </span>
      </>
    )
  }
  return <>{formatScientificName(scientificName)}</>
}
```

to:

```jsx
function SpeciesHeading({ scientificName, tone = 'light' }) {
  const common = useCommonName(scientificName)
  const sciClass =
    tone === 'dark'
      ? 'italic font-normal text-gray-300 text-sm'
      : 'italic font-normal text-gray-500 text-sm'
  if (!scientificName) return <>Blank</>
  if (common && common !== scientificName) {
    return (
      <>
        {toTitleCase(common)}{' '}
        <span className={sciClass}>({formatScientificName(scientificName)})</span>
      </>
    )
  }
  return <>{formatScientificName(scientificName)}</>
}
```

The default (`tone="light"`) preserves current behavior exactly — no caller breaks.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: no errors.

---

## Task 6: Frontend — `ImageViewerModal` layout edits

**Files:**
- Modify: `src/renderer/src/ui/BestMediaCarousel.jsx`, lines 79-257

Three JSX changes inside `ImageViewerModal`: import the new pill, add the species overlay over the image area, and rewrite the footer.

- [ ] **Step 1: Add the `DeploymentLinkPill` import**

Near the existing imports at the top of `BestMediaCarousel.jsx` (around lines 5-6, with the other module-level imports), add:

```js
import DeploymentLinkPill from '../media/DeploymentLinkPill'
```

- [ ] **Step 2: Add the species overlay in the image area**

The image area at lines 222-238 currently looks like:

```jsx
          {/* Media area */}
          <div className="flex-1 min-h-0 flex items-center justify-center bg-black overflow-hidden relative">
            {imageError ? (
              <div className="flex flex-col items-center justify-center bg-gray-800 text-gray-400 aspect-[4/3] min-w-[70vw] max-h-[calc(90vh-152px)]">
                <CameraOff size={128} />
                <span className="mt-4 text-lg font-medium">Image not available</span>
                {media.fileName && <span className="mt-2 text-sm">{media.fileName}</span>}
              </div>
            ) : (
              <img
                src={constructImageUrl(media.filePath, studyId)}
                alt={media.scientificName || 'Wildlife'}
                className="max-w-full max-h-[calc(90vh-152px)] w-auto h-auto object-contain"
                onError={() => setImageError(true)}
              />
            )}
          </div>
```

Insert the overlay before the conditional. Change to:

```jsx
          {/* Media area */}
          <div className="flex-1 min-h-0 flex items-center justify-center bg-black overflow-hidden relative">
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/60 text-white text-sm pointer-events-none">
              <SpeciesHeading scientificName={media.scientificName} tone="dark" />
            </div>
            {imageError ? (
              <div className="flex flex-col items-center justify-center bg-gray-800 text-gray-400 aspect-[4/3] min-w-[70vw] max-h-[calc(90vh-152px)]">
                <CameraOff size={128} />
                <span className="mt-4 text-lg font-medium">Image not available</span>
                {media.fileName && <span className="mt-2 text-sm">{media.fileName}</span>}
              </div>
            ) : (
              <img
                src={constructImageUrl(media.filePath, studyId)}
                alt={media.scientificName || 'Wildlife'}
                className="max-w-full max-h-[calc(90vh-152px)] w-auto h-auto object-contain"
                onError={() => setImageError(true)}
              />
            )}
          </div>
```

`pointer-events-none` ensures the overlay never intercepts clicks intended for the image (e.g., backdrop close).

- [ ] **Step 3: Rewrite the footer**

The footer at lines 240-252 currently looks like:

```jsx
          {/* Footer */}
          <div className="px-4 py-2.5 bg-gray-50 flex-shrink-0 border-t border-gray-200">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-medium text-gray-800 truncate flex-1 min-w-0">
                <SpeciesHeading scientificName={media.scientificName} />
              </span>
              {media.fileName && (
                <span className="font-mono text-[11px] text-gray-400 flex-shrink-0">
                  {media.fileName}
                </span>
              )}
            </div>
          </div>
```

Change to:

```jsx
          {/* Footer */}
          <div className="px-4 py-2.5 bg-gray-50 flex-shrink-0 border-t border-gray-200">
            <div className="flex items-center gap-3 min-w-0">
              {media.fileName && (
                <span className="font-mono text-[11px] text-gray-400 truncate min-w-0 flex-1">
                  {media.fileName}
                </span>
              )}
              {media.deploymentID && (
                <DeploymentLinkPill
                  studyId={studyId}
                  deploymentID={media.deploymentID}
                  locationName={media.locationName}
                  locationID={media.locationID}
                  interactive={true}
                  onNavigate={handleClose}
                />
              )}
            </div>
          </div>
```

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: no errors.

---

## Task 7: Frontend — `VideoViewerModal` layout edits

**Files:**
- Modify: `src/renderer/src/ui/BestMediaCarousel.jsx`, lines 262-558

Same overlay + footer rewrite as Task 6, applied to the video modal.

- [ ] **Step 1: Locate the video area's container**

The video modal's media area is the `<div>` containing the `<video>` element (and its placeholder error/transcoding states). Find the outer container with `className="… relative …"` that wraps the video — it should be analogous to the image modal's `<div className="flex-1 min-h-0 flex items-center justify-center bg-black overflow-hidden relative">`. (Read the file around line 480 onward to confirm exact location and existing className.)

- [ ] **Step 2: Insert the species overlay**

Inside that outer container, immediately after its opening tag, insert the same overlay used in `ImageViewerModal`:

```jsx
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/60 text-white text-sm pointer-events-none">
              <SpeciesHeading scientificName={media.scientificName} tone="dark" />
            </div>
```

The container already has `relative` positioning (and existing siblings — the duration/error badges at ~1812 / ~2050 — already use absolute positioning, confirming the parent supports it).

- [ ] **Step 3: Rewrite the footer**

The video modal's footer at lines 541-553 currently looks like:

```jsx
          {/* Footer */}
          <div className="px-4 py-2.5 bg-gray-50 flex-shrink-0 border-t border-gray-200">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-medium text-gray-800 truncate flex-1 min-w-0">
                <SpeciesHeading scientificName={media.scientificName} />
              </span>
              {media.fileName && (
                <span className="font-mono text-[11px] text-gray-400 flex-shrink-0">
                  {media.fileName}
                </span>
              )}
            </div>
          </div>
```

Change to (identical to the image modal's footer):

```jsx
          {/* Footer */}
          <div className="px-4 py-2.5 bg-gray-50 flex-shrink-0 border-t border-gray-200">
            <div className="flex items-center gap-3 min-w-0">
              {media.fileName && (
                <span className="font-mono text-[11px] text-gray-400 truncate min-w-0 flex-1">
                  {media.fileName}
                </span>
              )}
              {media.deploymentID && (
                <DeploymentLinkPill
                  studyId={studyId}
                  deploymentID={media.deploymentID}
                  locationName={media.locationName}
                  locationID={media.locationID}
                  interactive={true}
                  onNavigate={handleClose}
                />
              )}
            </div>
          </div>
```

The video modal's onClose handler is also named `handleClose` (mirrors the image modal's). Confirm by skimming the modal's prop destructuring at the top of `VideoViewerModal`.

- [ ] **Step 4: Lint and format**

```bash
npm run lint && npm run format
```

Expected: no errors.

- [ ] **Step 5: Commit Tasks 5-7 together**

The three frontend changes (`SpeciesHeading` tone prop + `ImageViewerModal` rewrite + `VideoViewerModal` rewrite) are tightly coupled — they all live in `BestMediaCarousel.jsx` and reach a working state together.

```bash
git add src/renderer/src/ui/BestMediaCarousel.jsx
git commit -m "feat(best-captures): species overlay + deployment link in modals"
```

---

## Task 8: Manual verification in the running app

**Files:** none modified.

The renderer changes have no unit tests. Verify in the dev server.

- [ ] **Step 1: Rebuild for Electron and start the dev server**

```bash
npm run test:rebuild-electron && npm run dev
```

- [ ] **Step 2: Verify `ImageViewerModal`**

1. Open a study. Navigate to the Overview tab.
2. Click any best-capture image in the `BestCapturesSection`.
3. Verify:
   - Top-center of the image: black semi-transparent pill with the common name (and italic scientific name if available). White text, readable.
   - Footer-left: filename in monospace, gray. Truncates on overflow.
   - Footer-right: `📍 <Location Name> →` pill. Hover turns it blue; tooltip says "Open in Deployments tab".
4. Click the deployment pill — modal closes, URL changes to `…/deployments?deploymentID=…`, deployment auto-selects with detail pane sliding up.

- [ ] **Step 3: Verify `VideoViewerModal`**

If the loaded study has any video best-captures, click one and verify the same three layout elements (overlay, filename-left, pill-right). If no videos exist in the current study, this is a soft skip — note in the PR description.

- [ ] **Step 4: Verify the fallback label**

For a media on a deployment without a `locationName`, the pill should display the `locationID`. If neither is set, "View deployment".

---

## Self-review notes

- **Spec coverage.** Section 1 (backend extension) → Tasks 2-3 (with Task 1 the failing-test setup). Section 2 (component extraction) → Task 4. Section 3 (`SpeciesHeading` tone prop) → Task 5. Section 4 (`ImageViewerModal` layout) → Task 6. Section 5 (`VideoViewerModal` layout) → Task 7. Section 6 (testing) → Task 1 + Task 8.
- **Placeholder scan.** Every step contains the actual code or shell command; no TBDs, no "implement later".
- **Type / name consistency.** `DeploymentLinkPill` props match the call sites in Tasks 6 and 7 (and the existing usage in `Gallery.jsx`, which still imports the same component). `SpeciesHeading`'s `tone` prop is added in Task 5 and consumed by overlays in Tasks 6 and 7. `handleClose` is the existing close handler in both modals — the plan reuses it without renaming.
