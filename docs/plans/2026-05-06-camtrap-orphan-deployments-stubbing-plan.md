# Stub orphan-FK deployments at CamTrap-DP import time — implementation plan

**Date:** 2026-05-06
**Spec:** [`docs/specs/2026-05-06-camtrap-orphan-deployments-stubbing-design.md`](../specs/2026-05-06-camtrap-orphan-deployments-stubbing-design.md)
**Branch:** `arthur/fix-lila-import-missing-deployments` (or a new branch off `main`)

## Goal

Land the spec as a single PR. Each step below is independently verifiable; do
not advance without the verify check passing.

## Steps

### 1. Helper: `collectOrphanDeployments`

**Touch:** `src/main/services/import/parsers/orphanDeployments.js` (new)

Pure function, ESM, no DB:
```js
export async function collectOrphanDeployments({
  directoryPath, knownDeploymentIDs, signal
}): Promise<Map<string, { start, end, mediaCount, obsCount }>>
```

- Stream `media.csv` if it exists; for each row whose `deploymentID` is not in
  `knownDeploymentIDs`, accumulate min/max ISO `timestamp` (lex compare) and
  bump `mediaCount`.
- Stream `observations.csv` if it exists; same logic against `eventStart` /
  `eventEnd`, bumping `obsCount`. Extend the per-id `start`/`end` window if
  observations push it earlier/later than media.
- Honour `signal.aborted` between rows; throw `DOMException('Import cancelled', 'AbortError')`.
- Use the same `csv-parser` import style as `camtrapDP.js`.
- Treat empty-string timestamps as missing (don't pollute min/max).

**Verify:** unit tests pass — see step 5.

### 2. Wire pre-pass and stub insert into `camtrapDP.js`

**Touch:** `src/main/services/import/parsers/camtrapDP.js`

After the `deployments.csv` insert finishes (`camtrapDP.js:114-164`, around
the loop iteration where `name === 'deployments'`):

1. Build `knownDeploymentIDs: Set<string>` by querying the `deployments` table
   we just populated (`SELECT deploymentID FROM deployments`).
2. Call `collectOrphanDeployments({ directoryPath, knownDeploymentIDs, signal })`.
3. If the resulting Map is non-empty:
   - Build stub rows: `{ deploymentID: id, locationID: id, locationName: null,
     deploymentStart, deploymentEnd, latitude: null, longitude: null,
     cameraModel: null, cameraID: null, coordinateUncertainty: null }`.
   - Insert via `createBulkInserter(sqlite, 'deployments', columns)` in one
     transaction.
   - `log.warn` per stub: ID, mediaCount, obsCount, time window. Cap at 50
     log lines.
4. Continue with the existing `media.csv` / `observations.csv` loop iterations.

For the `observations.csv` insert: extend `transformRowToSchema` (or wrap the
inserter loop) to drop rows whose `mediaID` is non-empty AND not in the
inserted media set. Build the media-set lazily after the media insert
finishes (or query `SELECT mediaID FROM media` — the table is fully populated
by then). Count drops.

Track `synthesized = { deployments, orphanMediaRows, orphanObservationRows,
droppedObservationRows }` through the function. Return as a top-level field
on the result.

**Verify:** integration test passes — see step 5. Existing camtrapDP tests
still pass: `npm test -- camtrapDP`.

### 3. Forward `synthesized` to the renderer via the import-complete payload

**Touch:** `src/main/ipc/import.js`

Two call sites: GBIF import (`import.js:656`) and any folder-picker import
that calls `importCamTrapDataset` (search for `importCamTrapDataset(`).

For each: capture the new `synthesized` field on the result and include it in
the `complete`-stage `sendGbifImportProgress` payload, plus the value
returned to the IPC caller.

**Verify:** `grep -n synthesized src/main/ipc/import.js` shows it forwarded
on every CamTrap-DP-completing path.

### 4. GBIF blacklist cleanup

**Touch:** `src/shared/gbifTitles.js`

Remove two entries from `GBIF_UNAVAILABLE`:

- `f0963153-077b-4676-a337-891a06fab52a` (Forest First Mammals — fixed by
  this PR).
- `13101e81-bc62-4553-9fd9-c5c8eb3fb9ab` (Norwegian Alpine Tundra Rodents —
  endpoint returns 200 today; the 403 in the comment is stale).

Verify the second one with one curl as documented in the spec — guard
against this changing again between writing the spec and merging the PR:

```bash
curl -sIL "https://ipt.nina.no/archive.do?r=rodent_2025" | head -1
```

Expect `HTTP/2 200`. If it now 403s again, leave the entry in.

**Verify:** `npm test` (the picker uses `isGbifAvailable`, no test should
regress).

### 5. Tests

**Touch:**
- `test/main/services/import/parsers/orphanDeployments.test.js` (new)
- `test/main/services/import/parsers/camtrapDP-orphan.test.js` (new)

Cases per spec § Testing. Prefer the existing in-memory better-sqlite3
fixture pattern used elsewhere in `test/main/`; if there isn't one for the
camtrapDP parser yet, build a small CamTrap-DP fixture under `test/fixtures/
camtrap-orphan/` with hand-written `datapackage.json`, `deployments.csv`,
`media.csv`, `observations.csv` (≤10 rows total).

**Verify:** `npm test` passes; new tests appear in the report.

### 6. Documentation updates

**Touch (in this order):**

1. **`docs/import-export.md`** — CamTrap DP Import section (line 62-93). Add
   a new paragraph after the "Description sanitization" paragraph titled
   **"Orphan deploymentID recovery"**:

   > CamTrap-DP datasets occasionally ship with `media.csv` or
   > `observations.csv` rows that reference `deploymentID`s missing from
   > `deployments.csv` — typically a curator oversight. The importer
   > pre-scans these files after the deployments insert, synthesizes a stub
   > deployment row for each orphan ID (with `locationID = deploymentID`,
   > NULL location/camera fields, and a time window derived from the
   > referencing rows' min/max timestamps), then proceeds with the media and
   > observations inserts. Observation rows whose `mediaID` is missing from
   > `media.csv` are dropped. Counts are returned in the import-complete
   > payload (`synthesized.deployments`, `synthesized.orphanMediaRows`,
   > `synthesized.orphanObservationRows`, `synthesized.droppedObservationRows`)
   > and logged at warn level.

2. **`docs/data-formats.md`** — under the CamTrap DP section, add a one-line
   note: *"Synthesized stub deployments (created when media/observations
   reference unknown deploymentIDs) are written with `locationID =
   deploymentID`, `locationName = NULL`, and `latitude / longitude / cameraID
   / cameraModel / coordinateUncertainty = NULL`. `deploymentStart` /
   `deploymentEnd` are derived from referencing rows' timestamps."*

3. **`docs/troubleshooting.md`** — under `## Import Issues` (line 5), add a
   new entry **after** the "Missing images after import" entry (line 24):

   > ### "FOREIGN KEY constraint failed" on CamTrap-DP import
   >
   > Resolved automatically as of 2026-05-06. Datasets where `media.csv` or
   > `observations.csv` reference `deploymentID`s missing from
   > `deployments.csv` no longer abort the import — the parser synthesizes
   > minimal stub deployment rows for the orphan IDs. If you see this error,
   > the dataset has a FK violation the importer cannot recover from
   > automatically (e.g., observations referencing a missing `mediaID` shape
   > we don't yet handle). Check the import log for `Synthesized stub
   > deployment` warnings to see what was auto-recovered.

**Verify:** the three doc files render cleanly; no broken links from the
spec's "Documentation updates" section to renamed headers.

### 7. Manual smoke test

Before opening the PR, run the actual failing dataset end-to-end:

1. Build / dev: `npm run dev`.
2. Open the GBIF picker, select **Forest First Mammals, Colombia**
   (`f0963153-077b-4676-a337-891a06fab52a`) — it should now appear (no
   longer in `GBIF_UNAVAILABLE`).
3. Import. Expect:
   - Import completes.
   - Toast / import-complete message references "9 synthesized deployments
     from 1,571 orphan media rows".
   - Deployments tab shows 88 + 9 = 97 entries; the 9 stubs (`FFB030`,
     `FFB031`, `FFB032`, `FFB033`, `FFB034`, `FFB035`, `FFB006A`, `FFP021`,
     `Segundo muestreo`) are not pinned on the map but render with
     time-window sparklines and media counts matching the spec's table.
   - Inline-renaming `Segundo muestreo` to e.g. "Bad ID" persists across a
     refresh.
4. Verify in SQLite:
   ```sql
   SELECT deploymentID, locationID, latitude, longitude, deploymentStart, deploymentEnd
   FROM deployments WHERE locationName IS NULL;
   ```
   Expect the 9 stubs with `locationID = deploymentID` and NULL coords.

**Verify:** manual checks above all pass.

## Open decisions to make at implementation time

These don't block the spec; they're choices to lock in while writing the
code:

- **Toast wording.** Renderer team's call. Spec only commits to surfacing
  the counts.
- **Log cap.** 50 IDs is a reasonable default; revisit if real datasets push
  past it.
- **Where to compute `knownDeploymentIDs`.** Querying SQLite right after
  insert is simplest; alternatively, accumulate the IDs during the
  `deployments.csv` insert via a row callback in `insertCSVData`. SQLite
  query is cheaper to ship; row callback is faster to run. Default to the
  SQLite query unless profiling says otherwise.
- **`csv-parser` vs hand-rolled stream.** Stick with `csv-parser` — it's
  already a dependency and the perf delta is irrelevant for orphan-detection
  pre-passes.

## Out of plan

The five other GBIF blacklist entries (Snapshot Japan, three DwC-A-only
Australian datasets, and the `f0963153` cousin entries) — different failure
modes, separate specs/plans.
