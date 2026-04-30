# Overview tab revamp — editorial showcase layout

**Date:** 2026-04-30
**Status:** Design — approved
**Area:** renderer (`src/renderer/src/overview.jsx`, `src/renderer/src/ui/BestMediaCarousel.jsx`); shared (`src/shared/speciesInfo`); main (`src/main/index.js` IPC additions)

## Summary

Restructure the Overview tab from its current kitchen-sink layout into a
single editorial dashboard with five always-rendered sections: title,
editorial header (description + contributor byline + map), KPI band, best
captures, species distribution. Same shell every study, gracefully empty
bands when data is missing. Edit affordances remain inline but recede —
revealed on hover, clean by default. Contributor cards move from the
showcase into a modal opened from the byline.

## Motivation

The current Overview reads as a kitchen sink. Title, description,
contributors, best-captures carousel, species distribution, and map all
sit at roughly equal visual weight, with editing affordances (pencils,
dashed "Add" cards) layered on top. Specifically:

1. **Visual hierarchy is muddy.** Title, description, contributors,
   carousel, species, and map all look the same weight; nothing leads
   the eye.
2. **Contributors read as disconnected business cards.** The horizontally
   scrollable strip of `w-48` cards never lands as part of the study's
   story.
3. **No sense of scope at a glance.** Headline numbers (cameras,
   locations, time span, observations, species) exist in the data but
   are never surfaced as readable scale.
4. **Typography is generic.** Standard Tailwind grays/blues with no
   typographic hierarchy beyond `font-medium` on the title.

The Overview is the tab a researcher lands on first and the one shared
with collaborators or stakeholders. It should read like the front cover
of a report: striking, story-led, and identical in shell across studies
so viewers know where to look.

## Goals

- Editorial-cover layout: same five sections, same slots, every study.
- KPI band that surfaces scope at a glance, with derived sub-details
  (threatened count, locations, date range, camera-days, media count).
- Always-rendered "Best captures" band with a polite empty state — never
  removed.
- Map elevated to a top-right hero slot (always available — every
  camera-trap study has a place; map is study-specific even before any
  ML run).
- Species list moved to full width (the bottom species/map split goes
  away).
- Editing stays inline but invisible by default — affordances reveal on
  hover, click-to-edit. Contributor cards live behind a "Manage" modal,
  not on the showcase.
- Date span auto-derived (override → observations → deployments → media
  → "—") with override editable from the span KPI tile.
- Existing Biowatch palette only — no new accent colors.

## Non-goals

- Hero image with fallback chain. Considered and rejected — image
  availability varies wildly across studies (no bboxes, no favorites →
  empty), and an adaptive hero would make studies look structurally
  different from each other.
- Inline thumbnail per species row. Considered and rejected — many rows
  lack imagery (no study image, no `speciesInfo` entry), so the result
  is a wall of placeholders.
- Replacing the deployment map component. The new layout uses
  `DeploymentMap` as-is, only at a different size and position.
- Replacing the species hover card. `SpeciesTooltipContent` continues to
  pop on row hover and gracefully renders nothing when no image exists.
- Replacing `BestMediaCarousel` internals. The carousel keeps its
  current scoring heuristic, scroll buttons, modal viewer, and favorite
  workflow — only its position and surrounding chrome change.
- Adding new colors. Stick to existing Tailwind blues/grays/whites.
- Internationalisation. Date formatters stay `en-US` for this revamp.

## Visual layout

Five sections, top to bottom, each always rendered:

```
┌──────────────────────────────────────────────────────────────┐
│  Title                                                  [✎]   │  1. Title
│                                                                │
│  ┌──────────────────────────────┐  ┌────────────────────────┐ │
│  │ Description (line-clamp 5)   │  │                        │ │  2. Editorial
│  │ Show more ↓                  │  │      Map (always)      │ │     header
│  │ ──────────────────────────── │  │                        │ │
│  │ By A · B · C +N more · ✎ Mgr │  │                        │ │
│  └──────────────────────────────┘  └────────────────────────┘ │
│                                                                │
│  ┌────┬────┬────┬────┬────┐                                   │
│  │ 47 │ 32 │ 4y │12k │1.2M│   3. KPI band (5 tiles, icons,    │
│  │ Sp │Cam │Spn │Obs │Med │      sub-details)                  │
│  └────┴────┴────┴────┴────┘                                   │
│                                                                │
│  Best captures                                                 │
│  [📷][📷][📷][📷][📷][📷]→   4. Best captures band             │
│                                                                │
│  Species distribution                                          │
│  ▌ Red Fox   LC ████████████ 234                              │  5. Species
│  ▌ Roe Deer  LC ████████ 187                                  │     list (full
│  ▌ Wild Boar LC ██████ 142                                    │     width)
│  ▌ ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

### 1. Title

- Single line (`text-2xl font-semibold`), clickable when `data.homepage`
  is set (current behavior preserved).
- Edit affordance: faint pencil at end of title on header hover. Click
  the title text or the pencil → inline input (current
  `isEditingTitle` flow).

### 2. Editorial header

A two-column grid (`grid-cols-[55%_1fr]` with `gap-6`):

**Left column** — description + contributor byline:

- Description block: `text-sm text-gray-700 leading-relaxed`,
  `max-w-prose`, line-clamp 5 with `Show more ↓` toggle (current
  truncation hook stays).
- Edit affordance: hovering the description block shows a faint dashed
  outline (`hover:outline outline-1 outline-dashed outline-blue-200`).
  Click anywhere in the block → inline textarea (current
  `isEditingDescription` flow).
- Contributors byline below the description, separated by a thin
  divider (`border-t border-gray-100 pt-3 mt-3`):
  - Format: `By <name> · <name> · <name> +N more · ✎ Manage`
  - Each name is plain text colored `text-gray-600`,
    `hover:text-blue-600 hover:underline` on hover. Names show role/org
    in the contributors panel; not in the byline itself.
  - Truncate to **first 3 contributors**; remainder collapses into
    `+N more` (greyed out). Both `+N more` and any individual name are
    clickable to open the Manage modal.
  - `✎ Manage` link appears at the end of the byline only on hover of
    the editorial header.
  - When `data.contributors` is empty: byline reads `No contributors
yet ·  ✎ Add` (pencil always visible in this case).

**Right column** — map:

- `DeploymentMap` component (existing) at fixed height `h-56` (224 px).
- Same satellite/street layer toggle, same cluster behavior, same
  popup. No code change inside the component.
- When `deploymentsData` has no rows OR no rows have valid
  coordinates: the existing `PlaceholderMap` renders in the same slot
  (no width/height change). Behavior matches today; only the size and
  position differ.

### 3. KPI band

`grid-cols-5 gap-2` of 5 tiles (`Variant C` from brainstorming).

Tile structure:

```
┌─────────────────────────┐
│ 🐾  SPECIES             │   ← icon (lucide PawPrint, blue-600,
│                         │     14×14) + uppercase label,
│ 47                      │     gray-500, 0.65rem, tracking-wide
│                         │
│ 8 threatened            │   ← sub-detail, gray-600, accent number
└─────────────────────────┘     in blue-700 font-semibold
```

Tile chrome: `bg-white border border-gray-200 rounded-lg px-3.5 py-3.5
hover:border-blue-300 hover:bg-slate-50`. Number is
`text-2xl font-bold text-gray-900 tabular-nums`.

The 5 tiles, with their icon, label, source, and sub-detail:

| #   | Icon (Lucide)  | Label        | Number                                            | Sub-detail                                                                                            |
| --- | -------------- | ------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | `PawPrint`     | Species      | distinct `observations.scientificName` count      | `<N> threatened` — count of distinct species whose `speciesInfo` IUCN category ∈ {VU, EN, CR, EW, EX} |
| 2   | `Camera`       | Cameras      | distinct `deployments.cameraID` count             | `across <N> locations` — distinct `deployments.locationID` count                                      |
| 3   | `CalendarDays` | Span         | year delta — formatted `<N> yr` or `<N> mo`       | `<short start> – <short end>` — derived range (see "Date derivation" below)                           |
| 4   | `Eye`          | Observations | `observations` row count                          | `from <N> camera-days` — sum of deployment durations across all deployments                           |
| 5   | `Image`        | Media        | `media` row count, formatted `1.2K` / `1.2M` etc. | `photos & videos`                                                                                     |

Tile #3 (Span) is editable: hovering it shows a faint pencil in the
top-right corner. Click the tile or pencil opens the existing
`DateTimePicker` popover, pre-populated with the current effective
range. The picker gets a new "Reset to auto" link that clears
`metadata.startDate` and `metadata.endDate`, allowing derivation to
take over.

Tiles 1, 2, 4, 5 are not editable. (Locations is folded into Cameras'
sub-detail; the previous standalone "Locations" tile from earlier
mockups is dropped to make room for Media.)

#### Empty states for KPI tiles

When the underlying data is missing or zero, replace the number with
an em-dash (`—`) in `text-gray-400`. Sub-detail can also degrade:

| Tile         | Empty number condition                         | Empty sub-detail                         |
| ------------ | ---------------------------------------------- | ---------------------------------------- |
| Species      | no observations OR all observations are blanks | omit (no "0 threatened")                 |
| Cameras      | no deployments                                 | omit                                     |
| Span         | no derivable range (chain exhausted)           | omit                                     |
| Observations | no observations                                | omit (don't render "from 0 camera-days") |
| Media        | no media                                       | "photos & videos" stays                  |

### 4. Best captures band

Full-width section directly below the KPI band:

- Section header: `Best captures` in
  `text-xs uppercase tracking-wider text-gray-500 font-semibold`.
- Below the header: existing `BestMediaCarousel` component, rendered
  at the same `w-48 h-36` card size as today (carousel internals
  unchanged).
- Empty state: when `getBestMedia` returns 0 rows, the carousel
  currently returns `null` (`BestMediaCarousel.jsx:761`). Replace this
  with a placeholder strip:
  ```
  ┌──────────────────────────────────────────────────────┐
  │ 📷  Top captures will appear here after classification│
  └──────────────────────────────────────────────────────┘
  ```
  `bg-gray-50 border border-dashed border-gray-200 rounded-lg
px-4 py-6 text-sm text-gray-500 text-center`. No CTA button — the
  message is enough; "Run a model" actions live elsewhere.
- Modify `BestMediaCarousel` to accept a `renderEmpty` prop; the
  Overview passes the placeholder. Other callers (none today) keep the
  current null-return behavior by omitting the prop.

### 5. Species distribution

Full-width list, one section header `Species distribution` matching
the Best captures style.

Internal row layout: largely the existing `SpeciesRow` structure,
restyled for full-width and with a small fixed-width name block:

```
┌──────────────────────────────────────────────────────────────┐
│ Red Fox  Vulpes vulpes      [LC] ████████████████  234        │
│ Roe Deer Capreolus capreolus [LC] ████████████      187        │
│ Wild Boar Sus scrofa         [LC] ████████          142        │
│ ...                                                            │
└──────────────────────────────────────────────────────────────┘
```

Per row (existing markup adapted):

- Name block: fixed `w-64`, common name (`text-sm text-gray-900
font-medium capitalize`) + scientific name (`text-xs italic
text-gray-400 ml-2`).
- IUCN badge: existing `IucnBadge` component, no change.
- Bar: flex-1, `h-2 bg-gray-100 rounded-full`, fill `bg-blue-600`,
  width `(species.count / totalCount) * 100%`.
- Count: `w-12 text-right text-sm text-gray-500 tabular-nums`.

Behaviors preserved exactly:

- Hover card with image (`SpeciesTooltipContent` via `HoverCard.Root`).
- Click row → navigate to media filtered by species (`navigate(...)`).
- `sortSpeciesHumansLast` ordering.
- `scrollSignal` mechanism that closes hover cards on container scroll.

Empty state (no species data, e.g., no observations yet):

```
┌──────────────────────────────────────────────────────┐
│ No species detected yet                               │
│ Run a classification model to see what's been         │
│ captured.                                             │
└──────────────────────────────────────────────────────┘
```

Same `bg-gray-50 border-dashed` placeholder treatment as Best captures.

## Edit affordances

The header is in "view mode" by default — no pencils, no buttons. On
mouse enter of the editorial header (the title-row + description
column), affordances surface:

| Element             | View                                | Hover-revealed              | Click target              | Edit UI                                                                                                 |
| ------------------- | ----------------------------------- | --------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Title               | plain `<a>` (or text)               | faint pencil at end of line | title text or pencil      | Inline `<input>` — existing `isEditingTitle` flow                                                       |
| Description         | prose with `Show more`              | dashed outline around block | anywhere in the block     | Inline `<textarea>` — existing `isEditingDescription` flow                                              |
| Contributors byline | "By A · B · C +N more"              | `✎ Manage` link at end      | `Manage` link or any name | **New**: contributors modal (see below)                                                                 |
| Span KPI tile       | tile with number + range sub-detail | pencil top-right corner     | tile body or pencil       | Existing `DateTimePicker` popover, pre-populated with current effective range; "Reset to auto" link new |

Hover state implementation: a single `group` class on the editorial
header section + `group-hover:opacity-100 opacity-0` on the pencils,
matching the existing pattern (`overview.jsx:920-927`).

The KPI band is _not_ part of the editorial header's hover group; the
Span tile manages its own hover state independently so hovering it
doesn't reveal the title pencil and vice versa.

### Contributors modal

Replaces the inline horizontally-scrollable strip of contributor
cards entirely. The cards UI (`overview.jsx:1031-1156`) and the
inline "Add contributor" card (`overview.jsx:1160-1236`) move into a
modal opened from the byline's `✎ Manage` link.

Modal chrome (mirrors existing delete-confirmation modal,
`overview.jsx:1268-1303`):

- `fixed inset-0 bg-black/50 z-[1000]` backdrop, click backdrop or
  Escape closes.
- Centered card: `bg-white rounded-lg shadow-xl max-w-lg w-full p-6`.
- Header: `Manage contributors` (`text-lg font-medium`) + sub-line
  describing the role of contributors.
- List of contributor rows (vertical, not horizontal cards):
  ```
  ┌────────────────────────────────────────────────┐
  │ Lou Smith                              ✎  🗑    │
  │ Principal Investigator · Acme Foundation        │
  └────────────────────────────────────────────────┘
  ```
  Each row uses the existing edit/delete state (`editingContributorIndex`,
  `setDeletingContributorIndex`). Inline-edit form replaces the row
  in place (mirrors current behavior, just stacked instead of in a
  card grid).
- Add button at bottom: `+ Add contributor` — opens an inline
  add-form row using existing `isAddingContributor` /
  `newContributor` state.
- Footer: `Done` button (closes modal). Clicking outside also closes.

The delete-confirmation flow (`deletingContributorIndex` modal) keeps
its current behavior — it's already a separate modal layered above.

## Date derivation

The Span KPI tile's number and sub-detail come from a derived effective
range (start, end). Resolution chain (first non-null wins):

1. **Override**: `metadata.startDate` and `metadata.endDate` (both must
   be set; partial override is allowed and uses the same chain for
   the missing side independently).
2. **Observations**: `min(observations.eventStart)` /
   `max(observations.eventStart)`.
3. **Deployments**: `min(deployments.deploymentStart)` /
   `max(deployments.deploymentEnd)`.
4. **Media**: `min(media.timestamp)` / `max(media.timestamp)`.
5. **None**: tile shows `—` for the number and omits the sub-detail.

The chain runs independently per side (start, end), so a study with
no override but observations on one side and deployments on the other
shows a sensible range.

Display:

- Number: span as `<N> yr` if ≥ 12 months; otherwise `<N> mo`.
  Round to nearest. (`4y` → `4 yr`; `3 mo` for 90-day spans.)
- Sub-detail: `MMM 'YY – MMM 'YY` (e.g. `Jan '20 – Dec '24`) using
  Intl.DateTimeFormat with `month: 'short', year: '2-digit'`.

The same range powers the deprecated `renderTemporalData` editing
inline; that function (`overview.jsx:821-893`) is removed (it was
already commented as `eslint-disable no-unused-vars` and not called).

When the user clicks the Span tile and saves, behavior matches today:
sets `metadata.startDate` and `metadata.endDate`. The new "Reset to
auto" button clears both, falling back to derivation.

## Sub-detail derivations

All sub-details derive from existing tables. New IPC additions consolidate
these into a single overview-stats query.

| Sub-detail             | Source                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `<N> threatened`       | join species set (distinct `scientificName`) against `speciesInfo`; count those with IUCN ∈ {VU, EN, CR, EW, EX} |
| `across <N> locations` | `SELECT COUNT(DISTINCT locationID) FROM deployments WHERE locationID IS NOT NULL`                                |
| `<from> – <to>`        | derived range (see Date derivation)                                                                              |
| `from <N> camera-days` | `SELECT SUM(julianday(deploymentEnd) - julianday(deploymentStart)) FROM deployments WHERE both fields not null`  |
| `photos & videos`      | static label                                                                                                     |

A new IPC method `getOverviewStats(studyId)` returns:

```js
{
  speciesCount: number,
  threatenedCount: number,
  cameraCount: number,
  locationCount: number,
  observationCount: number,
  cameraDays: number,            // sum of deployment durations in days
  mediaCount: number,
  derivedRange: {                // pre-derived for the renderer
    start: string | null,        // ISO date
    end: string | null           // ISO date
  }
}
```

The renderer uses this single payload instead of multiple per-tile
queries. The IPC handler lives in `src/main/index.js` alongside other
study/IPC methods; the underlying queries live in a new
`src/main/database/queries/overviewStats.js` module.

`speciesInfo` lookup for the threatened count happens server-side in
`overviewStats.js` so the renderer doesn't need to ship the entire
dictionary just to compute the count.

## Empty / loading states

Each section handles its empty/loading state independently:

- **Title / description / byline**: render whatever is in `data` (or
  the existing italic placeholders for empty description and "No
  contributors yet" byline).
- **Map**: existing `PlaceholderMap` when no deployments / no
  coordinates.
- **KPI band**: each tile shows `—` when its number can't be
  derived; sub-detail omitted (see table above).
- **Best captures**: dashed placeholder strip when carousel is empty.
- **Species**: dashed placeholder when no observations.

The current `importStatus.isRunning && done === 0` "Loading model…"
spinner covering the species/map area (`overview.jsx:1245-1251`) is
removed; instead, KPI tiles, Best captures, and Species each
gracefully show their empty states. The Map tile continues to render
during import and updates live (existing `refetchInterval: 5000`).

## Behavior preserved (no change)

To prevent regressions, these behaviors must remain identical:

- Title editing: click pencil or click outside saves; Enter saves;
  Escape cancels. `homepage` link target preserved.
- Description editing: Cmd/Ctrl+Enter saves; Escape cancels; click
  outside saves.
- Contributor add/edit form: Enter saves; Escape cancels; click
  outside cancels.
- Delete contributor confirmation modal.
- Map: layer persistence per study (`mapLayer:${studyId}` localStorage
  key), bounds fitting, marker clustering, custom camera icon, popup
  with location name + date range.
- Best captures: 12 most-recent best, scoring heuristic, scroll
  buttons, fade gradients, image+video viewer modals, favorite toggle,
  query invalidation hooks.
- Species rows: hover card, navigate-on-click,
  `sortSpeciesHumansLast`, scroll-signal close behavior.
- All `useImportStatus` polling and refetch behavior across queries.

## Files touched (preview)

- `src/renderer/src/overview.jsx` — major restructure:
  remove contributor strip, add editorial header grid, add KPI band,
  reposition map and species, hide pencils/buttons by default,
  remove dead `renderTemporalData`. Estimated: ~700 LOC down from
  ~1300 (most of the savings are removed contributor-card markup,
  now in the modal).
- `src/renderer/src/overview/` (new) — extract sub-components:
  - `EditorialHeader.jsx`
  - `ContributorByline.jsx`
  - `ContributorsModal.jsx` (the modal, owns the existing CRUD state)
  - `KpiBand.jsx` and `KpiTile.jsx`
  - `BestCapturesSection.jsx` (thin wrapper around
    `BestMediaCarousel` with the section header + empty placeholder)
  - `SpeciesDistribution.jsx` (already exists in `overview.jsx` —
    promote to its own file)
- `src/renderer/src/ui/BestMediaCarousel.jsx` — accept new
  `renderEmpty` prop; default behavior unchanged (returns `null`).
- `src/renderer/src/ui/DateTimePicker.jsx` — accept optional
  `onResetToAuto` prop; render a "Reset to auto" link in the picker
  footer when provided.
- `src/main/index.js` — register new
  `getOverviewStats(studyId)` IPC handler.
- `src/preload/index.js` — expose `getOverviewStats`.
- `src/main/database/queries/overviewStats.js` (new) — the
  consolidated query module.
- `docs/ipc-api.md`, `docs/database-schema.md`,
  `docs/architecture.md` — update for new IPC + query paths
  (per CLAUDE.md doc-maintenance contract).

## Open implementation questions

- Whether `getOverviewStats` should poll during ingest (matching the
  existing 5-second `refetchInterval` while `importStatus.isRunning`)
  or only refetch on completion. Default: match existing behavior.
- Whether the contributors-modal close on Esc/backdrop click should
  warn when an unsaved add/edit form is open. Default: discard
  silently (matches existing inline-card click-outside behavior).
- Naming: "from 4,200 camera-days" vs "across 4,200 camera-days".
  Pick one in implementation; the spec uses "from" as the more
  common phrasing in field-research literature.

## Implementation deltas

Decisions accepted during manual verification (Task 11) that diverge
from the original spec above. The shipped commits are the source of
truth; this section is a navigation aid for readers who only read the
spec.

- **"Featured species" fallback band** (was: hide Best Captures when
  empty). When `getBestMedia` returns nothing but observations exist,
  the band falls back to a strip of cards using bundled
  `speciesInfo.imageUrl` (Wikipedia thumbnails). Excludes blanks,
  humans/vehicles, non-species labels, and a small set of common
  domestic species (cat, dog, horse, chicken, cow). See
  `src/renderer/src/overview/CommonSpeciesFallback.jsx`.
- **Span tile is a real range picker** (was: single `DateTimePicker`
  reused for the start, end as future work). New `SpanPicker` shows
  two side-by-side calendars with one shared Reset/Cancel/Save row.
  Single popover instance. `src/renderer/src/overview/SpanPicker.jsx`.
- **Threatened-species popover.** When `threatenedCount > 0`, the
  Species KPI tile becomes clickable and opens a list of the
  threatened species (with hover cards). Spec mentioned the count;
  the popover was added during verification.
- **Hover cards on cards.** Both Best Captures cards and Featured
  species cards now wrap their click target with a HoverCard that
  pops a larger `SpeciesTooltipContent` (size='lg'). Same hover-card
  pattern as the species list rows. The tooltip gained a `size` prop
  with `lg` adding bigger image / wider card / larger text; default
  `md` unchanged.
- **Vertical resize handle.** Page wrapped in `react-resizable-panels`
  PanelGroup (vertical). Top panel: editorial header (with map
  growing to fill height) + KPI band. Bottom panel: best captures +
  species. Preference persists via `autoSaveId='overview-layout'`.
  Map slot is `h-full` instead of fixed `h-80`.
- **PortalPopover.** Span and Threatened popovers render via
  `createPortal` to `document.body` so they escape the Panel's
  `overflow: hidden`. Position recomputes on window resize and
  scroll.
- **IUCN legend includes NE.** "Not Evaluated" row added to the
  legend at the bottom of the species list.
- **Card sizes / styling.** Best Captures and Featured species cards
  share a single style: `w-56 / h-40 image area`, name footer below,
  `shadow / hover:shadow-md`. Best Captures dropped its internal
  `<h3>` and the timestamp footer (the latter looked weird when
  missing). Strip wrappers have `py-3` so hover shadow doesn't get
  clipped by the carousel's `overflow-x-auto`.
- **Map styling.** `rounded-xl` + `shadow-md` + `overflow-hidden` on
  both the loaded map and `PlaceholderMap` (which was also shrunk so
  the underlying world map stays visible around it).
- **`Cameras` → `Deployments`.** The KPI tile counts
  `COALESCE(cameraID, deploymentID)` — most importers don't
  populate `cameraID`, so "Deployments" matches what's actually
  counted.
- **Compact camera-days.** Sub-line uses `formatCompactCount`
  (lowercase `k` from 1000) instead of `formatStatNumber` so
  `from 1,095 camera-days` doesn't wrap on narrow viewports.
- **Single-popover state.** `KpiBand` uses one `openPopover`
  enum (`'span' | 'threatened' | null`) so opening one
  auto-closes the other.
- **Domestic-species filter.** New `isDomestic(scientificName)` in
  `utils/speciesUtils.js` covers cat / dog / horse / chicken / cow.
  Used only by the Featured species fallback; the species
  distribution list still shows them.
- **Loading skeleton.** `SpeciesDistribution` shows 5 pulsing
  placeholder rows while the query is in flight; the
  "No species detected yet" empty state now only renders after the
  query resolves with zero rows.
- **Description editing.** Textarea auto-grows to fit content (capped
  at 60vh) so it no longer shrinks below the displayed prose.
