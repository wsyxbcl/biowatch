# Link from Media Modal to Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a footer pill in the media modal (`ImageModal`) that, in the global Media tab, navigates to the corresponding deployment in the Deployments tab; in the Deployments-tab consumer, the same label renders as static, non-clickable text.

**Architecture:** Three layers — (1) extend the sequences DB query to return `locationID` and `locationName` per media row via a `LEFT JOIN` on `deployments`; (2) thread the existing `deploymentID` prop from `Gallery` to `ImageModal` so the modal knows whether it is in the deployment-scoped consumer; (3) add a small `DeploymentLinkPill` component inside `Gallery.jsx` that renders the new field as a button (interactive variant) or span (static variant) in the modal footer.

**Tech Stack:** Drizzle ORM (SQLite), React, react-router (`useNavigate`), lucide-react (`MapPin`), `node:test` for backend tests.

**Spec:** `docs/specs/2026-05-05-link-deployment-from-media-modal-design.md`

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/main/database/queries/sequences.js` | Modify | Extend `getMediaForSequencePagination` to return `locationID` and `locationName` per row. Adds one import and one LEFT JOIN per query builder. |
| `test/main/database/queries.test.js` | Modify | Add a test asserting the new fields are present and correctly joined from the deployments table. |
| `src/renderer/src/media/Gallery.jsx` | Modify | (a) Accept `deploymentID` as an `ImageModal` prop. (b) Pass it from `Gallery` → `ImageModal`. (c) Define `DeploymentLinkPill` component. (d) Render it in the modal footer. (e) Add `MapPin` and `useNavigate` imports. |

No new files. The pill component lives alongside `ImageModal` per the spec — it is small (~25 lines) and the file already holds many local sub-components.

---

## Task 1: Backend — Failing test for `locationID` / `locationName` in query results

**Files:**
- Modify: `test/main/database/queries.test.js` (append a new `test(...)` inside the existing `describe('getMediaForSequencePagination with no date filter', …)` block at line 721)

The existing helper `createTestData(testDbPath)` already inserts `deploy001` with `locationID: 'loc001'` and `locationName: 'Forest Site A'` (see line 65-83). We piggyback on that.

- [ ] **Step 1: Write the failing test**

Append the following test inside the existing `describe('getMediaForSequencePagination with no date filter', () => { … })` block at the bottom of the file (line ~807, just before the block's closing `})` ):

```js
    test('returns locationID and locationName for each media row', async () => {
      await createTestData(testDbPath)

      const result = await getMediaForSequencePagination(testDbPath, {
        species: ['Cervus elaphus'],
        dateRange: {}
      })

      assert.ok(result.media.length > 0, 'should return at least one media row')
      for (const row of result.media) {
        // Cervus elaphus media live on deploy001 → loc001 / Forest Site A
        assert.equal(row.locationID, 'loc001', `row ${row.mediaID} should carry locationID`)
        assert.equal(
          row.locationName,
          'Forest Site A',
          `row ${row.mediaID} should carry locationName`
        )
      }
    })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:rebuild && node --test --test-name-pattern="returns locationID and locationName" test/main/database/queries.test.js
```

Expected: FAIL — the assertion `row.locationID === 'loc001'` errors because the field is `undefined` (the query does not yet select it). After: `npm run test:rebuild-electron`.

- [ ] **Step 3: Commit the failing test**

```bash
git add test/main/database/queries.test.js
git commit -m "test(sequences): expect locationID/locationName in media rows"
```

---

## Task 2: Backend — Add LEFT JOIN on `deployments` and project location fields

**Files:**
- Modify: `src/main/database/queries/sequences.js`

Five places in `selectFields*` need the two new fields, and seven query-builder call sites need a new `.leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))`.

- [ ] **Step 1: Add `deployments` to the imports**

At line 7, change:

```js
import { getDrizzleDb, media, observations } from '../index.js'
```

to:

```js
import { getDrizzleDb, deployments, media, observations } from '../index.js'
```

- [ ] **Step 2: Add the two location fields to `selectFields` (line 97)**

Change:

```js
    const selectFields = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      scientificName: sql`NULL`.as('scientificName'),
      fileMediatype: media.fileMediatype,
      eventID: sql`(${eventIDPicker})`.as('eventID'),
      favorite: media.favorite
    }
```

to:

```js
    const selectFields = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      locationID: deployments.locationID,
      locationName: deployments.locationName,
      scientificName: sql`NULL`.as('scientificName'),
      fileMediatype: media.fileMediatype,
      eventID: sql`(${eventIDPicker})`.as('eventID'),
      favorite: media.favorite
    }
```

- [ ] **Step 3: Add the two location fields to `selectFieldsVehicle` (line 112)**

Change:

```js
    const selectFieldsVehicle = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      scientificName: sql`${VEHICLE_SENTINEL}`.as('scientificName'),
      fileMediatype: media.fileMediatype,
      eventID: sql`(${eventIDPicker})`.as('eventID'),
      favorite: media.favorite
    }
```

to:

```js
    const selectFieldsVehicle = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      locationID: deployments.locationID,
      locationName: deployments.locationName,
      scientificName: sql`${VEHICLE_SENTINEL}`.as('scientificName'),
      fileMediatype: media.fileMediatype,
      eventID: sql`(${eventIDPicker})`.as('eventID'),
      favorite: media.favorite
    }
```

- [ ] **Step 4: Add the two location fields to `selectFieldsWithObs` (line 124)**

Change:

```js
    const selectFieldsWithObs = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      scientificName: observations.scientificName,
      fileMediatype: media.fileMediatype,
      eventID: observations.eventID,
      favorite: media.favorite
    }
```

to:

```js
    const selectFieldsWithObs = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      locationID: deployments.locationID,
      locationName: deployments.locationName,
      scientificName: observations.scientificName,
      fileMediatype: media.fileMediatype,
      eventID: observations.eventID,
      favorite: media.favorite
    }
```

- [ ] **Step 5: Add LEFT JOIN to `buildSpeciesArm` (line 167)**

Change:

```js
    const buildSpeciesArm = (extraConds) =>
      db
        .selectDistinct(selectFieldsWithObs)
        .from(media)
        .innerJoin(observations, eq(media.mediaID, observations.mediaID))
        .where(
          and(
            ...extraConds,
            isNotNull(observations.scientificName),
            ne(observations.scientificName, ''),
            inArray(observations.scientificName, regularSpecies)
          )
        )
```

to:

```js
    const buildSpeciesArm = (extraConds) =>
      db
        .selectDistinct(selectFieldsWithObs)
        .from(media)
        .innerJoin(observations, eq(media.mediaID, observations.mediaID))
        .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
        .where(
          and(
            ...extraConds,
            isNotNull(observations.scientificName),
            ne(observations.scientificName, ''),
            inArray(observations.scientificName, regularSpecies)
          )
        )
```

- [ ] **Step 6: Add LEFT JOIN to `buildBlankArm` (line 181)**

Change:

```js
    const buildBlankArm = (extraConds) =>
      db
        .selectDistinct(selectFields)
        .from(media)
        .where(and(...extraConds, notExists(realObservations)))
```

to:

```js
    const buildBlankArm = (extraConds) =>
      db
        .selectDistinct(selectFields)
        .from(media)
        .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
        .where(and(...extraConds, notExists(realObservations)))
```

- [ ] **Step 7: Add LEFT JOIN to `buildVehicleArm` (line 187)**

Change:

```js
    const buildVehicleArm = (extraConds) =>
      db
        .selectDistinct(selectFieldsVehicle)
        .from(media)
        .where(and(...extraConds, exists(vehicleObservations)))
```

to:

```js
    const buildVehicleArm = (extraConds) =>
      db
        .selectDistinct(selectFieldsVehicle)
        .from(media)
        .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
        .where(and(...extraConds, exists(vehicleObservations)))
```

- [ ] **Step 8: Add LEFT JOIN to the no-species-filter timestamped path (line 287)**

Change:

```js
      if (species.length === 0) {
        // No species filter - get all media
        timestampedMedia = await db
          .selectDistinct(selectFields)
          .from(media)
          .where(and(...timestampedConditions))
          .orderBy(sql`${media.timestamp} DESC, ${media.mediaID} DESC`)
          .limit(batchSize)
```

to:

```js
      if (species.length === 0) {
        // No species filter - get all media
        timestampedMedia = await db
          .selectDistinct(selectFields)
          .from(media)
          .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
          .where(and(...timestampedConditions))
          .orderBy(sql`${media.timestamp} DESC, ${media.mediaID} DESC`)
          .limit(batchSize)
```

- [ ] **Step 9: Add the location fields and LEFT JOIN to the regular-species inline select (line 339)**

Change:

```js
        timestampedMedia = await db
          .select({
            mediaID: media.mediaID,
            filePath: media.filePath,
            fileName: media.fileName,
            timestamp: media.timestamp,
            deploymentID: media.deploymentID,
            scientificName: sql`(${speciesPicker(observations.scientificName)})`.as(
              'scientificName'
            ),
            fileMediatype: media.fileMediatype,
            eventID: sql`(${speciesPicker(observations.eventID)})`.as('eventID'),
            favorite: media.favorite
          })
          .from(media)
          .where(
            and(
              ...timestampedConditions,
              exists(
                db
                  .select({ one: sql`1` })
                  .from(observations)
                  .where(
                    and(
                      eq(observations.mediaID, media.mediaID),
                      inArray(observations.scientificName, regularSpecies)
                    )
                  )
              )
            )
          )
          .orderBy(sql`${media.timestamp} DESC, ${media.mediaID} DESC`)
          .limit(batchSize)
```

to:

```js
        timestampedMedia = await db
          .select({
            mediaID: media.mediaID,
            filePath: media.filePath,
            fileName: media.fileName,
            timestamp: media.timestamp,
            deploymentID: media.deploymentID,
            locationID: deployments.locationID,
            locationName: deployments.locationName,
            scientificName: sql`(${speciesPicker(observations.scientificName)})`.as(
              'scientificName'
            ),
            fileMediatype: media.fileMediatype,
            eventID: sql`(${speciesPicker(observations.eventID)})`.as('eventID'),
            favorite: media.favorite
          })
          .from(media)
          .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
          .where(
            and(
              ...timestampedConditions,
              exists(
                db
                  .select({ one: sql`1` })
                  .from(observations)
                  .where(
                    and(
                      eq(observations.mediaID, media.mediaID),
                      inArray(observations.scientificName, regularSpecies)
                    )
                  )
              )
            )
          )
          .orderBy(sql`${media.timestamp} DESC, ${media.mediaID} DESC`)
          .limit(batchSize)
```

- [ ] **Step 10: Add LEFT JOIN to the null-phase no-species path (line 443)**

Change:

```js
      if (species.length === 0) {
        nullMedia = await db
          .selectDistinct(selectFields)
          .from(media)
          .where(and(...nullConditions))
          .orderBy(sql`${media.mediaID} DESC`)
          .limit(batchSize)
          .offset(offset)
```

to:

```js
      if (species.length === 0) {
        nullMedia = await db
          .selectDistinct(selectFields)
          .from(media)
          .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
          .where(and(...nullConditions))
          .orderBy(sql`${media.mediaID} DESC`)
          .limit(batchSize)
          .offset(offset)
```

- [ ] **Step 11: Add the location fields and LEFT JOIN to the null-phase regular-species inline select (line 480)**

Change:

```js
        nullMedia = await db
          .select({
            mediaID: media.mediaID,
            filePath: media.filePath,
            fileName: media.fileName,
            timestamp: media.timestamp,
            deploymentID: media.deploymentID,
            scientificName: sql`(${speciesPicker(observations.scientificName)})`.as(
              'scientificName'
            ),
            fileMediatype: media.fileMediatype,
            eventID: sql`(${speciesPicker(observations.eventID)})`.as('eventID'),
            favorite: media.favorite
          })
          .from(media)
          .where(
            and(
              ...nullConditions,
              exists(
                db
                  .select({ one: sql`1` })
                  .from(observations)
                  .where(
                    and(
                      eq(observations.mediaID, media.mediaID),
                      inArray(observations.scientificName, regularSpecies)
                    )
                  )
              )
            )
          )
          .orderBy(sql`${media.mediaID} DESC`)
          .limit(batchSize)
          .offset(offset)
```

to:

```js
        nullMedia = await db
          .select({
            mediaID: media.mediaID,
            filePath: media.filePath,
            fileName: media.fileName,
            timestamp: media.timestamp,
            deploymentID: media.deploymentID,
            locationID: deployments.locationID,
            locationName: deployments.locationName,
            scientificName: sql`(${speciesPicker(observations.scientificName)})`.as(
              'scientificName'
            ),
            fileMediatype: media.fileMediatype,
            eventID: sql`(${speciesPicker(observations.eventID)})`.as('eventID'),
            favorite: media.favorite
          })
          .from(media)
          .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
          .where(
            and(
              ...nullConditions,
              exists(
                db
                  .select({ one: sql`1` })
                  .from(observations)
                  .where(
                    and(
                      eq(observations.mediaID, media.mediaID),
                      inArray(observations.scientificName, regularSpecies)
                    )
                  )
              )
            )
          )
          .orderBy(sql`${media.mediaID} DESC`)
          .limit(batchSize)
          .offset(offset)
```

- [ ] **Step 12: Run the new test, verify it now passes**

```bash
npm run test:rebuild && node --test --test-name-pattern="returns locationID and locationName" test/main/database/queries.test.js
```

Expected: PASS. After: `npm run test:rebuild-electron`.

- [ ] **Step 13: Run the full sequences test suite to confirm no regressions**

```bash
npm run test:rebuild && node --test test/main/database/queries.test.js
```

Expected: every test passes. After: `npm run test:rebuild-electron`.

- [ ] **Step 14: Commit the backend implementation**

```bash
git add src/main/database/queries/sequences.js
git commit -m "feat(sequences): include locationID/locationName in media rows"
```

---

## Task 3: Frontend — Thread `deploymentID` prop into `ImageModal`

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx` (two edits)

`Gallery` already accepts `deploymentID` (line 2162). `ImageModal` already receives `studyId` (line 2547). We just propagate the existing prop.

- [ ] **Step 1: Accept `deploymentID` in `ImageModal`'s prop list**

Find the `ImageModal` function signature (~line 211). It currently looks like:

```jsx
function ImageModal({
  isOpen,
  onClose,
  media,
  constructImageUrl,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  studyId,
  onTimestampUpdate,
  sequence,
  sequenceIndex,
  onSequenceNext,
  onSequencePrevious,
  hasNextInSequence,
  hasPreviousInSequence,
  isVideoMedia
}) {
```

Add `deploymentID` to the destructuring (any position is fine; keep next to `studyId` for readability):

```jsx
function ImageModal({
  isOpen,
  onClose,
  media,
  constructImageUrl,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  studyId,
  deploymentID,
  onTimestampUpdate,
  sequence,
  sequenceIndex,
  onSequenceNext,
  onSequencePrevious,
  hasNextInSequence,
  hasPreviousInSequence,
  isVideoMedia
}) {
```

- [ ] **Step 2: Pass `deploymentID` from `Gallery` to `ImageModal`**

At the `<ImageModal …>` call site (~line 2538), add the prop. The current JSX is:

```jsx
        <ImageModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          media={selectedMedia}
          constructImageUrl={constructImageUrl}
          onNext={handleNextImage}
          onPrevious={handlePreviousImage}
          hasNext={hasNextSequence}
          hasPrevious={hasPreviousSequence}
          studyId={id}
          onTimestampUpdate={handleTimestampUpdate}
          sequence={currentSequence}
          sequenceIndex={currentSequenceIndex}
          onSequenceNext={handleSequenceNext}
          onSequencePrevious={handleSequencePrevious}
          hasNextInSequence={hasNextInSequence}
          hasPreviousInSequence={hasPreviousInSequence}
          isVideoMedia={isVideoMedia}
        />
```

Change to (add `deploymentID={deploymentID}` next to `studyId`):

```jsx
        <ImageModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          media={selectedMedia}
          constructImageUrl={constructImageUrl}
          onNext={handleNextImage}
          onPrevious={handlePreviousImage}
          hasNext={hasNextSequence}
          hasPrevious={hasPreviousSequence}
          studyId={id}
          deploymentID={deploymentID}
          onTimestampUpdate={handleTimestampUpdate}
          sequence={currentSequence}
          sequenceIndex={currentSequenceIndex}
          onSequenceNext={handleSequenceNext}
          onSequencePrevious={handleSequencePrevious}
          hasNextInSequence={hasNextInSequence}
          hasPreviousInSequence={hasPreviousInSequence}
          isVideoMedia={isVideoMedia}
        />
```

- [ ] **Step 3: Verify the file still parses (lint)**

```bash
npm run lint
```

Expected: no new errors related to Gallery.jsx. (Cached lint may report unchanged warnings — those are fine.)

---

## Task 4: Frontend — Add `DeploymentLinkPill` and render it in the modal footer

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx` (three edits: imports, new component, footer JSX)

- [ ] **Step 1: Add `MapPin` to the lucide-react imports**

The lucide imports run from line 13 to line 34. The block currently ends with `Info`:

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

Change `Info` to `Info,\n  MapPin`:

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

- [ ] **Step 2: Add `useNavigate` to the react-router import**

Line 37 currently is:

```js
import { useParams } from 'react-router'
```

Change to:

```js
import { useNavigate, useParams } from 'react-router'
```

- [ ] **Step 3: Define the `DeploymentLinkPill` component**

Insert this component definition immediately *before* the `function ImageModal({…})` declaration (~line 211). Keeping it adjacent to `ImageModal` documents that it is a modal sub-component.

```jsx
/**
 * Footer pill in ImageModal that navigates to the corresponding deployment
 * in the Deployments tab. When `interactive` is false (the modal is opened
 * from inside the Deployments tab itself), renders the same label as a
 * static span — context, not a link.
 *
 * Label fallback: locationName → locationID → 'View deployment'.
 */
function DeploymentLinkPill({
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
        navigate(`/study/${studyId}/deployments?deploymentID=${deploymentID}`)
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

- [ ] **Step 4: Render the pill in the modal footer**

Find the modal footer block at line 1531, which currently is:

```jsx
          {/* Footer - filename only; observation editing lives in the rail */}
          <div className="px-4 py-2.5 bg-gray-50 flex-shrink-0 border-t border-gray-200 text-xs text-gray-600">
            <div className="flex items-center gap-3">
              {media.fileName && (
                <span className="font-mono text-[11px] text-gray-400 truncate min-w-0 flex-1">
                  {media.fileName}
                </span>
              )}
            </div>

            {classificationUpdatePending && (
              <p className="text-[11px] text-blue-500 mt-1">Updating classification...</p>
            )}
            {classificationUpdateError && (
              <p className="text-[11px] text-red-500 mt-1">
                Error: {classificationUpdateError?.message || 'Failed to update'}
              </p>
            )}
          </div>
```

Change the inner `<div className="flex items-center gap-3">` block to include the pill after the filename. The filename keeps `flex-1` so it pushes the pill to the right edge:

```jsx
          {/* Footer - filename + deployment link */}
          <div className="px-4 py-2.5 bg-gray-50 flex-shrink-0 border-t border-gray-200 text-xs text-gray-600">
            <div className="flex items-center gap-3">
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
                  interactive={!deploymentID}
                  onNavigate={onClose}
                />
              )}
            </div>

            {classificationUpdatePending && (
              <p className="text-[11px] text-blue-500 mt-1">Updating classification...</p>
            )}
            {classificationUpdateError && (
              <p className="text-[11px] text-red-500 mt-1">
                Error: {classificationUpdateError?.message || 'Failed to update'}
              </p>
            )}
          </div>
```

The `interactive={!deploymentID}` line is the visibility-rule branch:
- Media-tab consumer: `Gallery` is invoked without `deploymentID`, so `!deploymentID === true` → button.
- Deployments-tab consumer: `Gallery` is invoked with a `deploymentID`, so `!deploymentID === false` → static span.

The `media.deploymentID &&` guard hides the pill entirely when a media row has no deployment association (defensive — should not happen with normal data).

- [ ] **Step 5: Lint and format**

```bash
npm run lint && npm run format
```

Expected: no errors. Format may reflow minor whitespace; that is fine.

---

## Task 5: Manual verification in the running app

**Files:** none modified.

Component-level rendering tests would need React Testing Library wiring that the project does not currently have. Verify behavior with the dev server.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify the interactive variant in the Media tab**

1. Open a study. Navigate to the Media tab.
2. Click any thumbnail to open the modal.
3. Look at the bottom-right of the modal footer — there should be a `📍 <Location Name> →` pill, opposite the filename.
4. Hover the pill — it should show a tooltip "Open in Deployments tab" and the text should change color (gray → blue).
5. Click the pill — the modal should close, the URL should change to `#/study/<id>/deployments?deploymentID=<…>`, the Deployments tab should mount with that deployment selected (the list scrolls to it, the map flies to it, and the detail pane slides up showing the deployment's media).

- [ ] **Step 3: Verify the static variant in the Deployments tab**

1. From the Deployments tab, with a deployment selected, click any media thumbnail in the detail-pane gallery.
2. Inspect the modal footer — the pill should be present but rendered as a non-clickable, gray span (no hover effect, no chevron arrow, no tooltip).
3. Confirm clicking it does nothing.

- [ ] **Step 4: Verify the fallback label**

(Optional) If a study with deployments lacking `locationName` is available, open a media for one of those — the pill should display the `locationID` instead. If neither is set, it should display "View deployment".

- [ ] **Step 5: Commit the frontend changes**

```bash
git add src/renderer/src/media/Gallery.jsx
git commit -m "feat(media): link from media modal to deployment"
```

---

## Self-review notes

- **Spec coverage.** Part 1 (backend JOIN + new fields) → Tasks 1-2. Part 2 (thread `deploymentID` to ImageModal) → Task 3. Part 3 (`DeploymentLinkPill` + footer render) → Task 4. UX details (icon, label fallback, tooltip, hover) all baked into the component code in Task 4 Step 3.
- **No placeholders.** Every step contains the actual code or shell command needed.
- **Type/name consistency.** `DeploymentLinkPill` props match the spec call site exactly; `interactive={!deploymentID}` is the same in both plan and spec; field names `locationID`/`locationName` are consistent across SQL, JS, and JSX.
