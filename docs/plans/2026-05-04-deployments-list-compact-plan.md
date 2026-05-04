# Deployments list — compact rows, sections, popover lat/lon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the Deployments tab list per [the spec](../specs/2026-05-04-deployments-list-compact-design.md) — 40px compact rows, always-expanded section grouping, three-variant sparkline with persisted toggle, lat/lon editing moved to a popover in the detail pane.

**Architecture:** Frontend-only. No IPC, no DB, no worker changes. Decompose the rebuilt `LocationsList` into focused components: `Sparkline` (renderer), `SparklineToggle` (UI+localStorage), `SectionHeader`, `LocationPopover`. Pure helpers (`coordinateParser`, refactored `groupDeploymentsByLocation`) get unit tests via `node --test`. Components are wired into the existing `deployments.jsx` and `DeploymentDetailPane.jsx` and verified manually via the dev server.

**Tech Stack:** React, `@tanstack/react-virtual`, `react-leaflet`, Tailwind, `node --test`. No new npm dependencies — `LocationPopover` uses the same hand-rolled outside-click pattern as the existing `SpeciesFilterButton`.

---

## File Structure

**New files (renderer):**

| Path | Responsibility |
|------|----------------|
| `src/renderer/src/deployments/coordinateParser.js` | Pure `parseCoordinates(string) → {lat, lon} \| null` |
| `src/renderer/src/deployments/groupDeployments.js` | Pure `groupDeploymentsByLocation(deployments)` (extracted + refactored) |
| `src/renderer/src/deployments/Sparkline.jsx` | Renders bars / line / heatmap from `periods[]` |
| `src/renderer/src/deployments/SparklineToggle.jsx` | 3 icon buttons + localStorage persistence |
| `src/renderer/src/deployments/SectionHeader.jsx` | Gray section row with name, badge, aggregated sparkline, total |
| `src/renderer/src/deployments/LocationPopover.jsx` | Radix-style popover with paste + lat/lon inputs + place/clear |

**New tests:**

| Path | Covers |
|------|--------|
| `test/renderer/coordinateParser.test.js` | All parser inputs |
| `test/renderer/groupDeployments.test.js` | Sort interleave, aggregation |

**Modified:**

| Path | Change |
|------|--------|
| `src/renderer/src/deployments.jsx` | Remove `groupDeploymentsByLocation` (extracted), remove `LocationGroupHeader` & `GroupedDeploymentRow`, rewrite `DeploymentRow` to 40px, rebuild `LocationsList` for always-expanded sections, add section-header `flyTo`, add `SparklineToggle`. Drop `expandedGroups` state and related effects (`groupToExpand`, `onExpandGroup`, `handleExpandGroup`, `handleGroupExpanded`). |
| `src/renderer/src/deployments/DeploymentDetailPane.jsx` | Add 📍 icon button to header; wire `LocationPopover`. |
| `docs/architecture.md` | Note the new components under "renderer/src/deployments/" |

---

## Task 1: Coordinate parser

**Files:**
- Create: `src/renderer/src/deployments/coordinateParser.js`
- Test: `test/renderer/coordinateParser.test.js`

- [ ] **Step 1.1: Write the failing test**

Create `test/renderer/coordinateParser.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseCoordinates } from '../../src/renderer/src/deployments/coordinateParser.js'

describe('parseCoordinates', () => {
  test('parses comma-separated', () => {
    assert.deepEqual(parseCoordinates('48.7384, -121.4521'), { lat: 48.7384, lon: -121.4521 })
  })

  test('parses space-separated', () => {
    assert.deepEqual(parseCoordinates('48.7384 -121.4521'), { lat: 48.7384, lon: -121.4521 })
  })

  test('parses with trailing/leading whitespace', () => {
    assert.deepEqual(parseCoordinates('  48.7384, -121.4521  '), { lat: 48.7384, lon: -121.4521 })
  })

  test('parses integer coordinates', () => {
    assert.deepEqual(parseCoordinates('48, -121'), { lat: 48, lon: -121 })
  })

  test('parses both negative', () => {
    assert.deepEqual(parseCoordinates('-48.7, -121.4'), { lat: -48.7, lon: -121.4 })
  })

  test('returns null for invalid input', () => {
    assert.equal(parseCoordinates('not coordinates'), null)
    assert.equal(parseCoordinates('48.7'), null)
    assert.equal(parseCoordinates(''), null)
    assert.equal(parseCoordinates('TBD'), null)
  })

  test('returns null for out-of-range latitude', () => {
    assert.equal(parseCoordinates('91, 0'), null)
    assert.equal(parseCoordinates('-91, 0'), null)
  })

  test('returns null for out-of-range longitude', () => {
    assert.equal(parseCoordinates('0, 181'), null)
    assert.equal(parseCoordinates('0, -181'), null)
  })

  test('handles null/undefined input', () => {
    assert.equal(parseCoordinates(null), null)
    assert.equal(parseCoordinates(undefined), null)
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `node --test test/renderer/coordinateParser.test.js`
Expected: FAIL — module not found

- [ ] **Step 1.3: Implement the parser**

Create `src/renderer/src/deployments/coordinateParser.js`:

```js
/**
 * Parse a "lat, lon" string (or "lat lon") into numbers. Returns null
 * for any input that doesn't match a valid coordinate pair.
 *
 * Used by LocationPopover's combined paste field to populate the
 * lat/lon number inputs in one keystroke (Cmd+V).
 */
export function parseCoordinates(input) {
  if (input == null || typeof input !== 'string') return null
  const match = input.trim().match(/^(-?\d+(?:\.\d+)?)[\s,]+\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return null
  const lat = parseFloat(match[1])
  const lon = parseFloat(match[2])
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null
  if (lat < -90 || lat > 90) return null
  if (lon < -180 || lon > 180) return null
  return { lat, lon }
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `node --test test/renderer/coordinateParser.test.js`
Expected: PASS — all 9 tests green

- [ ] **Step 1.5: Commit**

```bash
git add src/renderer/src/deployments/coordinateParser.js test/renderer/coordinateParser.test.js
git commit -m "feat(deployments): add coordinate parser for paste field"
```

---

## Task 2: Refactored groupDeployments helper

Extract the existing `groupDeploymentsByLocation` from `deployments.jsx` and change its sort: alphabetical interleave (no longer "groups first").

**Files:**
- Create: `src/renderer/src/deployments/groupDeployments.js`
- Test: `test/renderer/groupDeployments.test.js`
- Modify: `src/renderer/src/deployments.jsx` (remove old definition, import from new file)

- [ ] **Step 2.1: Write the failing test**

Create `test/renderer/groupDeployments.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { groupDeploymentsByLocation } from '../../src/renderer/src/deployments/groupDeployments.js'

const mkPeriod = (count) => ({ start: '2024-01-01', end: '2024-02-01', count })

describe('groupDeploymentsByLocation', () => {
  test('returns empty array for empty input', () => {
    assert.deepEqual(groupDeploymentsByLocation([]), [])
    assert.deepEqual(groupDeploymentsByLocation(null), [])
    assert.deepEqual(groupDeploymentsByLocation(undefined), [])
  })

  test('treats single deployment as singleton group', () => {
    const result = groupDeploymentsByLocation([
      {
        deploymentID: 'd1',
        locationID: 'loc-A',
        locationName: 'Alpha',
        latitude: 1,
        longitude: 2,
        deploymentStart: '2024-01-01',
        periods: [mkPeriod(10)]
      }
    ])
    assert.equal(result.length, 1)
    assert.equal(result[0].isSingleDeployment, true)
    assert.equal(result[0].locationID, 'loc-A')
  })

  test('groups deployments sharing locationID', () => {
    const result = groupDeploymentsByLocation([
      { deploymentID: 'd1', locationID: 'loc-A', locationName: 'Alpha', deploymentStart: '2024-01-01', periods: [mkPeriod(5)] },
      { deploymentID: 'd2', locationID: 'loc-A', locationName: 'Alpha', deploymentStart: '2025-01-01', periods: [mkPeriod(7)] }
    ])
    assert.equal(result.length, 1)
    assert.equal(result[0].isSingleDeployment, false)
    assert.equal(result[0].deployments.length, 2)
    // Most recent first within group
    assert.equal(result[0].deployments[0].deploymentID, 'd2')
  })

  test('aggregates periods within a group by summing per-bucket counts', () => {
    const result = groupDeploymentsByLocation([
      { deploymentID: 'd1', locationID: 'loc-A', locationName: 'Alpha', deploymentStart: '2024-01-01', periods: [mkPeriod(5), mkPeriod(3)] },
      { deploymentID: 'd2', locationID: 'loc-A', locationName: 'Alpha', deploymentStart: '2025-01-01', periods: [mkPeriod(2), mkPeriod(8)] }
    ])
    assert.deepEqual(
      result[0].aggregatedPeriods.map((p) => p.count),
      [7, 11]
    )
  })

  test('sorts alphabetically with sections interleaved with singletons (NOT groups-first)', () => {
    const result = groupDeploymentsByLocation([
      { deploymentID: 'd1', locationID: 'loc-Z', locationName: 'Zulu', deploymentStart: '2024-01-01', periods: [mkPeriod(1)] },
      { deploymentID: 'd2', locationID: 'loc-M', locationName: 'Mike', deploymentStart: '2024-01-01', periods: [mkPeriod(1)] },
      { deploymentID: 'd3', locationID: 'loc-M', locationName: 'Mike', deploymentStart: '2025-01-01', periods: [mkPeriod(1)] },
      { deploymentID: 'd4', locationID: 'loc-A', locationName: 'Alpha', deploymentStart: '2024-01-01', periods: [mkPeriod(1)] }
    ])
    // Expected order: Alpha (singleton), Mike (group), Zulu (singleton)
    assert.equal(result[0].locationName, 'Alpha')
    assert.equal(result[1].locationName, 'Mike')
    assert.equal(result[2].locationName, 'Zulu')
  })

  test('falls back to locationID when locationName is missing', () => {
    const result = groupDeploymentsByLocation([
      { deploymentID: 'd1', locationID: 'loc-Beta', locationName: null, deploymentStart: '2024-01-01', periods: [mkPeriod(1)] },
      { deploymentID: 'd2', locationID: 'loc-Alpha', locationName: null, deploymentStart: '2024-01-01', periods: [mkPeriod(1)] }
    ])
    assert.equal(result[0].locationID, 'loc-Alpha')
    assert.equal(result[1].locationID, 'loc-Beta')
  })

  test('falls back to deploymentID when locationID is missing', () => {
    const result = groupDeploymentsByLocation([
      { deploymentID: 'd1', locationID: null, locationName: 'Alpha', deploymentStart: '2024-01-01', periods: [mkPeriod(1)] }
    ])
    assert.equal(result.length, 1)
    assert.equal(result[0].locationID, 'd1')
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `node --test test/renderer/groupDeployments.test.js`
Expected: FAIL — module not found

- [ ] **Step 2.3: Implement**

Create `src/renderer/src/deployments/groupDeployments.js`:

```js
/**
 * Sum per-bucket observation counts across multiple deployments at the
 * same location. Different deployments are different temporal samples,
 * so summing is correct here (distinct from the within-sequence
 * bbox-count rule, which uses max-per-frame).
 */
const aggregatePeriods = (deployments) => {
  if (deployments.length === 0) return []
  return deployments[0].periods.map((period, i) => ({
    start: period.start,
    end: period.end,
    count: deployments.reduce((sum, d) => sum + (d.periods[i]?.count || 0), 0)
  }))
}

/**
 * Group deployments by locationID and return one alphabetically-sorted
 * sequence interleaving multi-deploy groups with singletons. Each entry
 * has isSingleDeployment for the renderer to switch between section
 * header + children vs flat row.
 */
export function groupDeploymentsByLocation(deployments) {
  if (!deployments || deployments.length === 0) return []

  const groups = new Map()

  deployments.forEach((deployment) => {
    const key = deployment.locationID || deployment.deploymentID
    if (!groups.has(key)) {
      groups.set(key, {
        locationID: deployment.locationID || deployment.deploymentID,
        locationName: deployment.locationName,
        latitude: deployment.latitude,
        longitude: deployment.longitude,
        deployments: []
      })
    }
    groups.get(key).deployments.push(deployment)
  })

  // Within each group, most recent deployment first.
  groups.forEach((group) => {
    group.deployments.sort((a, b) => new Date(b.deploymentStart) - new Date(a.deploymentStart))
  })

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      aggregatedPeriods: aggregatePeriods(group.deployments),
      isSingleDeployment: group.deployments.length === 1
    }))
    .sort((a, b) => {
      const aName = a.locationName || a.locationID || ''
      const bName = b.locationName || b.locationID || ''
      return aName.localeCompare(bName)
    })
}
```

- [ ] **Step 2.4: Remove the inline definition from deployments.jsx**

In `src/renderer/src/deployments.jsx`:

Delete lines ~652-703 (the `aggregatePeriods` and `groupDeploymentsByLocation` function definitions).

Add at the top of the imports block (around line 13):

```js
import { groupDeploymentsByLocation } from './deployments/groupDeployments'
```

- [ ] **Step 2.5: Run test to verify it passes**

Run: `node --test test/renderer/groupDeployments.test.js`
Expected: PASS — all 7 tests green

- [ ] **Step 2.6: Run full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS

- [ ] **Step 2.7: Commit**

```bash
git add src/renderer/src/deployments/groupDeployments.js test/renderer/groupDeployments.test.js src/renderer/src/deployments.jsx
git commit -m "refactor(deployments): extract groupDeploymentsByLocation, sort alphabetically interleaved"
```

---

## Task 3: Sparkline component

**Files:**
- Create: `src/renderer/src/deployments/Sparkline.jsx`

- [ ] **Step 3.1: Implement the component**

Create `src/renderer/src/deployments/Sparkline.jsx`:

```jsx
import { memo } from 'react'

/**
 * Renders an activity sparkline for a deployment row. Three variants
 * sharing the same `periods` data:
 *   - 'bars'    → mini column chart (default)
 *   - 'line'    → smooth area chart (SVG)
 *   - 'heatmap' → colored cells, intensity = count
 *
 * `muted` swaps the primary color for slate-300, used on aggregated
 * section-header sparklines so children stand out.
 */
const Sparkline = memo(function Sparkline({ periods, mode = 'bars', percentile90Count, muted = false }) {
  if (!periods || periods.length === 0) return null
  const max = percentile90Count || 1

  if (mode === 'bars') {
    return (
      <div className="flex gap-px items-end h-[22px] w-full">
        {periods.map((period, i) => {
          const heightPct = period.count > 0
            ? Math.min((period.count / max) * 100, 100)
            : 0
          return (
            <div
              key={i}
              title={`${period.count} observations`}
              className={`flex-1 ${muted ? 'bg-slate-300' : 'bg-[#77b7ff]'} rounded-sm`}
              style={{
                height: `${heightPct}%`,
                minHeight: period.count > 0 ? '2px' : '1px',
                opacity: period.count > 0 ? 1 : 0.3
              }}
            />
          )
        })}
      </div>
    )
  }

  if (mode === 'line') {
    const stroke = muted ? '#94a3b8' : '#3b82f6'
    const points = periods.map((p, i) => {
      const x = (i / (periods.length - 1 || 1)) * 100
      const y = 22 - Math.min((p.count / max), 1) * 20
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    const linePath = `M${points.join(' L')}`
    const areaPath = `${linePath} L100,22 L0,22 Z`
    return (
      <svg
        viewBox="0 0 100 22"
        preserveAspectRatio="none"
        className="w-full h-[22px] block"
      >
        <path d={areaPath} fill={stroke} opacity="0.15" />
        <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" />
      </svg>
    )
  }

  if (mode === 'heatmap') {
    const palette = muted
      ? ['#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b']
      : ['#dbeafe', '#bfdbfe', '#60a5fa', '#3b82f6', '#1d4ed8']
    return (
      <div className="flex gap-px h-[14px] w-full items-stretch">
        {periods.map((period, i) => {
          const t = period.count > 0 ? period.count / max : 0
          const idx = period.count === 0 ? 0 : Math.min(palette.length - 1, Math.floor(t * palette.length))
          return (
            <div
              key={i}
              title={`${period.count} observations`}
              className="flex-1 rounded-sm"
              style={{ background: period.count > 0 ? palette[idx] : '#f9fafb' }}
            />
          )
        })}
      </div>
    )
  }

  return null
})

export default Sparkline
```

- [ ] **Step 3.2: Verify it builds**

Run: `npm run lint` (lints any new files)
Expected: PASS

- [ ] **Step 3.3: Commit**

```bash
git add src/renderer/src/deployments/Sparkline.jsx
git commit -m "feat(deployments): add Sparkline component (bars/line/heatmap)"
```

---

## Task 4: SparklineToggle component

**Files:**
- Create: `src/renderer/src/deployments/SparklineToggle.jsx`

- [ ] **Step 4.1: Implement**

Create `src/renderer/src/deployments/SparklineToggle.jsx`:

```jsx
import { BarChart3, LineChart, Grid3x3 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY_PREFIX = 'deploymentsSparkline:'

const MODES = [
  { id: 'bars', label: 'Bars', Icon: BarChart3 },
  { id: 'line', label: 'Line', Icon: LineChart },
  { id: 'heatmap', label: 'Heatmap', Icon: Grid3x3 }
]

/**
 * Three icon buttons that cycle the sparkline rendering mode for the
 * current study. Persisted in localStorage so the user's preference
 * survives navigation, mirroring the existing `mapLayer:${studyId}`
 * persistence pattern in deployments.jsx.
 */
export default function SparklineToggle({ studyId, mode, onChange }) {
  const handleClick = useCallback(
    (id) => {
      onChange(id)
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${studyId}`, id)
      } catch {
        // localStorage may be disabled — fall through, in-memory state still works
      }
    },
    [studyId, onChange]
  )

  return (
    <div className="flex items-center gap-px rounded border border-gray-200 bg-white p-px">
      {MODES.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => handleClick(id)}
          title={label}
          aria-label={`Sparkline: ${label}`}
          aria-pressed={mode === id}
          className={`p-1 rounded ${
            mode === id
              ? 'bg-blue-50 text-blue-700'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}

/**
 * Hook to read+write the sparkline mode for a study.
 */
export function useSparklineMode(studyId) {
  const [mode, setMode] = useState(() => {
    if (!studyId) return 'bars'
    try {
      return localStorage.getItem(`${STORAGE_KEY_PREFIX}${studyId}`) || 'bars'
    } catch {
      return 'bars'
    }
  })

  // If studyId changes (study switch), re-read.
  useEffect(() => {
    if (!studyId) return
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}${studyId}`)
      if (saved) setMode(saved)
    } catch {
      // ignore
    }
  }, [studyId])

  return [mode, setMode]
}
```

- [ ] **Step 4.2: Lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4.3: Commit**

```bash
git add src/renderer/src/deployments/SparklineToggle.jsx
git commit -m "feat(deployments): add SparklineToggle with localStorage persistence"
```

---

## Task 5: SectionHeader component

**Files:**
- Create: `src/renderer/src/deployments/SectionHeader.jsx`

- [ ] **Step 5.1: Implement**

Create `src/renderer/src/deployments/SectionHeader.jsx`:

```jsx
import { memo, useCallback } from 'react'
import EditableLocationName from './EditableLocationName'
import Sparkline from './Sparkline'

/**
 * Always-expanded section header for co-located deployments. Clicking
 * the header flies the map to the bounds of the group's children — it
 * does NOT change the current deployment selection (the detail pane
 * stays put if open).
 */
const SectionHeader = memo(function SectionHeader({
  group,
  sparklineMode,
  percentile90Count,
  isSelected,
  onRenameLocation,
  onSectionClick
}) {
  const handleClick = useCallback(() => {
    onSectionClick(group)
  }, [group, onSectionClick])

  return (
    <div
      onClick={handleClick}
      className={`flex gap-3 items-center px-3 h-9 bg-gray-100 hover:bg-gray-200 cursor-pointer border-b border-gray-200 transition-colors ${
        isSelected ? 'border-l-4 border-l-blue-500 pl-2' : 'border-l-4 border-l-transparent'
      }`}
    >
      <div className="flex items-center gap-2 w-[200px] min-w-0">
        <div className="min-w-0 flex-1">
          <EditableLocationName
            locationID={group.locationID}
            locationName={group.locationName}
            isSelected={isSelected}
            onRename={onRenameLocation}
          />
        </div>
        <span className="text-xs text-gray-600 bg-gray-300 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
          {group.deployments.length}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <Sparkline
          periods={group.aggregatedPeriods}
          mode={sparklineMode}
          percentile90Count={percentile90Count}
          muted
        />
      </div>

      <div className="flex-shrink-0 w-16 text-right text-xs text-gray-600 tabular-nums">
        {group.aggregatedPeriods.reduce((sum, p) => sum + (p.count || 0), 0).toLocaleString()}
      </div>
    </div>
  )
})

export default SectionHeader
```

- [ ] **Step 5.2: Lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 5.3: Commit**

```bash
git add src/renderer/src/deployments/SectionHeader.jsx
git commit -m "feat(deployments): add SectionHeader for always-expanded grouping"
```

---

## Task 6: Compact DeploymentRow rewrite

Strip the lat/lon inputs and place button. Single-line 40px layout. Use Sparkline.

**Files:**
- Modify: `src/renderer/src/deployments.jsx`

- [ ] **Step 6.1: Replace the DeploymentRow definition**

In `src/renderer/src/deployments.jsx`, replace the existing `DeploymentRow` (lines ~420-534) with:

```jsx
const DeploymentRow = memo(function DeploymentRow({
  location,
  isSelected,
  onSelect,
  onRenameLocation,
  sparklineMode,
  percentile90Count,
  indented = false
}) {
  const handleRowClick = useCallback(() => onSelect(location), [location, onSelect])
  const total = (location.periods || []).reduce((sum, p) => sum + (p.count || 0), 0)

  return (
    <div
      id={location.deploymentID}
      title={location.deploymentStart}
      onClick={handleRowClick}
      className={`flex gap-3 items-center px-3 h-10 hover:bg-gray-50 cursor-pointer border-b border-gray-100 transition-colors ${
        indented ? 'pl-9 bg-[#fcfcfd]' : ''
      } ${
        isSelected
          ? `bg-blue-50 border-l-4 border-l-blue-500 ${indented ? 'pl-8' : 'pl-2'}`
          : 'border-l-4 border-l-transparent'
      }`}
    >
      <div className="w-[200px] min-w-0">
        <EditableLocationName
          locationID={location.locationID}
          locationName={location.locationName}
          isSelected={isSelected}
          onRename={onRenameLocation}
        />
      </div>

      <div className="flex-1 min-w-0">
        <Sparkline
          periods={location.periods}
          mode={sparklineMode}
          percentile90Count={percentile90Count}
        />
      </div>

      <div className="flex-shrink-0 w-16 text-right text-xs text-gray-500 tabular-nums">
        {total.toLocaleString()}
      </div>
    </div>
  )
})
```

Add the imports at the top of `deployments.jsx`:

```js
import Sparkline from './deployments/Sparkline'
import SectionHeader from './deployments/SectionHeader'
import SparklineToggle, { useSparklineMode } from './deployments/SparklineToggle'
```

Remove the now-unused imports if any (`Camera`, `ChevronDown`, `ChevronRight`, `MapPin` from `lucide-react` — keep `Camera` and `MapPin` if still referenced elsewhere; verify after the next steps).

- [ ] **Step 6.2: Remove the old GroupedDeploymentRow + LocationGroupHeader**

In `src/renderer/src/deployments.jsx`:

- Delete the `LocationGroupHeader` definition (lines ~537-607).
- Delete the `GroupedDeploymentRow` definition (lines ~610-636).

- [ ] **Step 6.3: Lint and verify the file still parses**

Run: `npm run lint`
Expected: PASS (warnings about unused imports OK at this stage; we'll clean them up in Task 7).

- [ ] **Step 6.4: Commit**

```bash
git add src/renderer/src/deployments.jsx
git commit -m "refactor(deployments): compact DeploymentRow to 40px, drop inline lat/lon"
```

---

## Task 7: LocationsList rebuild — always-expanded sections

Wire SectionHeader, drop expand/collapse state, add SparklineToggle in the timeline header, update virtualizer estimateSize.

**Files:**
- Modify: `src/renderer/src/deployments.jsx`
- Modify: `src/renderer/src/deployments.jsx` (props down from `Deployments`)

- [ ] **Step 7.1: Replace LocationsList**

In `src/renderer/src/deployments.jsx`, replace the existing `LocationsList` definition (around line 705-952) with:

```jsx
function LocationsList({
  studyId,
  activity,
  selectedLocation,
  setSelectedLocation,
  onRenameLocation,
  onSectionClick,
  onPeriodCountChange
}) {
  const parentRef = useRef(null)
  const timelineRef = useRef(null)
  const [timelineWidth, setTimelineWidth] = useState(0)
  const [sparklineMode, setSparklineMode] = useSparklineMode(studyId)

  useEffect(() => {
    const node = timelineRef.current
    if (!node) return
    const ro = new ResizeObserver(([entry]) => {
      setTimelineWidth(entry.contentRect.width)
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const dateCount = timelineWidth ? Math.max(2, Math.min(15, Math.round(timelineWidth / 150))) : 5
  const periodCount = timelineWidth ? Math.max(10, Math.round(timelineWidth / 30 / 10) * 10) : 20

  useEffect(() => {
    onPeriodCountChange?.(periodCount)
  }, [periodCount, onPeriodCountChange])

  const locationGroups = useMemo(
    () => groupDeploymentsByLocation(activity.deployments),
    [activity.deployments]
  )

  // Flatten: every multi-deploy group emits a header + N children;
  // singletons emit one row. No expand/collapse state — the list is
  // always fully visible.
  const virtualItems = useMemo(() => {
    const items = []
    locationGroups.forEach((group) => {
      if (group.isSingleDeployment) {
        items.push({ type: 'single', deployment: group.deployments[0], group })
      } else {
        items.push({ type: 'group-header', group })
        group.deployments.forEach((deployment) => {
          items.push({ type: 'group-deployment', deployment, group })
        })
      }
    })
    return items
  }, [locationGroups])

  const dateMarkers = useMemo(
    () => getDateMarkers(activity.startDate, activity.endDate, dateCount),
    [activity.startDate, activity.endDate, dateCount]
  )

  const rowVirtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (virtualItems[index].type === 'group-header' ? 36 : 40),
    overscan: 8
  })

  // Scroll to selected
  useEffect(() => {
    if (!selectedLocation) return
    const index = virtualItems.findIndex((item) => {
      if (item.type === 'single' || item.type === 'group-deployment') {
        return item.deployment.deploymentID === selectedLocation.deploymentID
      }
      return false
    })
    if (index !== -1) {
      rowVirtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' })
    }
  }, [selectedLocation, virtualItems, rowVirtualizer])

  if (!activity.deployments || activity.deployments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="text-gray-400 mb-3">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <p className="text-gray-500 font-medium">No deployments found</p>
        <p className="text-gray-400 text-sm mt-1">Import deployment data to see camera locations</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <header className="bg-white z-10 py-2 border-b border-gray-300 flex items-stretch">
        {/* Date markers stretch across the activity column. The 200px
            left gutter matches the row's name column; the 64px right
            gutter matches the count column; toggle sits on the far right. */}
        <div className="w-[212px] flex-shrink-0" />
        <div ref={timelineRef} className="flex-1 flex justify-between text-xs text-gray-600">
          {dateMarkers.map((date, i) => (
            <div key={i} className="flex flex-col items-center flex-1 min-w-0">
              <span>{formatDateShort(date)}</span>
              <div className="w-px h-2 bg-gray-400 mt-1" />
            </div>
          ))}
        </div>
        <div className="w-16 flex-shrink-0" />
        <div className="px-2 flex items-center">
          <SparklineToggle studyId={studyId} mode={sparklineMode} onChange={setSparklineMode} />
        </div>
      </header>

      <div ref={parentRef} className="flex-1 overflow-auto min-h-0">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = virtualItems[virtualRow.index]
            const isSelectedDeployment = (deployment) =>
              deployment && selectedLocation?.deploymentID === deployment.deploymentID
            const sectionHasSelection = (group) =>
              group.deployments.some((d) => d.deploymentID === selectedLocation?.deploymentID)

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                {item.type === 'single' && (
                  <DeploymentRow
                    location={item.deployment}
                    isSelected={isSelectedDeployment(item.deployment)}
                    onSelect={setSelectedLocation}
                    onRenameLocation={onRenameLocation}
                    sparklineMode={sparklineMode}
                    percentile90Count={activity.percentile90Count}
                  />
                )}

                {item.type === 'group-header' && (
                  <SectionHeader
                    group={item.group}
                    sparklineMode={sparklineMode}
                    percentile90Count={activity.percentile90Count}
                    isSelected={sectionHasSelection(item.group)}
                    onRenameLocation={onRenameLocation}
                    onSectionClick={onSectionClick}
                  />
                )}

                {item.type === 'group-deployment' && (
                  <DeploymentRow
                    location={item.deployment}
                    isSelected={isSelectedDeployment(item.deployment)}
                    onSelect={setSelectedLocation}
                    onRenameLocation={onRenameLocation}
                    sparklineMode={sparklineMode}
                    percentile90Count={activity.percentile90Count}
                    indented
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7.2: Update the Deployments component to drop expand-state and pass new props**

In the `Deployments` component (around line 954+), remove these state variables and effects (no longer needed):

- `groupToExpand` state
- `setGroupToExpand` setter
- `handleExpandGroup` callback
- `handleGroupExpanded` callback

In the `DraggableMarker` event handler in `LocationMap`, remove the `onExpandGroup?.(location.locationID)` call (just inside the `click` handler around line 268-269).

Remove `onExpandGroup` from `DraggableMarker` props and from `LocationMap` props.

Add a new callback in `Deployments`:

```js
const handleSectionClick = useCallback((group) => {
  // Fly map to bounds of the group's children. Selection is unchanged.
  const positions = group.deployments
    .filter((d) => d.latitude != null && d.longitude != null)
    .map((d) => [parseFloat(d.latitude), parseFloat(d.longitude)])
  if (positions.length === 0) return
  const bounds = L.latLngBounds(positions)
  // We post the bounds via a ref the map subscribes to (see Task 8).
  sectionFlyToRef.current?.(bounds)
}, [])
```

…and a ref:

```js
const sectionFlyToRef = useRef(null)
```

Pass `onSectionClick={handleSectionClick}` to `LocationsList` and `flyToRef={sectionFlyToRef}` to `LocationMap`.

Pass `studyId={studyId}` to `LocationsList` (used by `useSparklineMode`).

- [ ] **Step 7.3: Clean unused imports**

In `src/renderer/src/deployments.jsx`, remove from the `lucide-react` import:
- `ChevronDown`
- `ChevronRight`

(Keep `Camera`, `MapPin`, `X` — `Camera` is used in `createCameraIcon`, `MapPin`/`X` in the place-mode banner.)

- [ ] **Step 7.4: Lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 7.5: Run tests**

Run: `npm test`
Expected: PASS — no test changes, just regression check.

- [ ] **Step 7.6: Commit**

```bash
git add src/renderer/src/deployments.jsx
git commit -m "feat(deployments): always-expanded sections with sparkline toggle"
```

---

## Task 8: LocationMap — section-header flyTo bounds

Add a ref-based imperative API so `Deployments` can ask the map to fly to a bounds without going through the selection state.

**Files:**
- Modify: `src/renderer/src/deployments.jsx`

- [ ] **Step 8.1: Add a FlyToBoundsHandler**

In `src/renderer/src/deployments.jsx`, add a new internal component near `FlyToSelected` (around line 191):

```jsx
function FlyToBoundsHandler({ flyToRef }) {
  const map = useMap()
  useEffect(() => {
    if (!flyToRef) return
    flyToRef.current = (bounds) => {
      map.flyToBounds(bounds, { duration: 0.8, padding: [40, 40] })
    }
    return () => {
      flyToRef.current = null
    }
  }, [map, flyToRef])
  return null
}
```

- [ ] **Step 8.2: Use it in LocationMap**

In `LocationMap`, accept `flyToRef` as a prop, and add `<FlyToBoundsHandler flyToRef={flyToRef} />` next to `<FlyToSelected ... />` inside the `<MapContainer>`.

- [ ] **Step 8.3: Manual verification**

Run: `npm run dev`

Test scenarios:
- Open a study with at least one multi-deployment location.
- Click a section header → map flies to the bounds of those children. Detail pane state is unchanged.
- Open the detail pane on a deployment → click a different section header → detail pane stays open, map flies to that section's bounds.
- Single-deployment row click → still selects normally and flies to that point.

- [ ] **Step 8.4: Commit**

```bash
git add src/renderer/src/deployments.jsx
git commit -m "feat(deployments): section-header click flies map to group bounds"
```

---

## Task 9: LocationPopover component

Hand-rolled popover (mirrors `SpeciesFilterButton`'s outside-click pattern) with the combined paste field, lat/lon inputs, place-on-map button, and clear button.

**Files:**
- Create: `src/renderer/src/deployments/LocationPopover.jsx`

- [ ] **Step 9.1: Implement**

Create `src/renderer/src/deployments/LocationPopover.jsx`:

```jsx
import { MapPin } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseCoordinates } from './coordinateParser'

/**
 * Triggered by the 📍 button in the detail pane header. Three input
 * surfaces all bound to the same lat/lon pair:
 *   1) Combined paste field — accepts "lat, lon" or "lat lon",
 *      auto-splits into the inputs below.
 *   2) Two number inputs — labeled, autosaves on blur.
 *   3) "Place on map" — closes the popover and engages place mode on
 *      the big map; the existing flow takes over.
 */
export default function LocationPopover({
  deployment,
  onCommitLatLon,
  onClearLatLon,
  onEnterPlaceMode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef(null)
  const popoverRef = useRef(null)

  const initialLat = deployment.latitude
  const initialLon = deployment.longitude

  const [latInput, setLatInput] = useState(initialLat ?? '')
  const [lonInput, setLonInput] = useState(initialLon ?? '')
  const [combinedInput, setCombinedInput] = useState(() =>
    initialLat != null && initialLon != null ? `${initialLat}, ${initialLon}` : ''
  )

  // Resync local state when the popover opens against a different deployment.
  useEffect(() => {
    setLatInput(initialLat ?? '')
    setLonInput(initialLon ?? '')
    setCombinedInput(
      initialLat != null && initialLon != null ? `${initialLat}, ${initialLon}` : ''
    )
  }, [initialLat, initialLon])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const onDown = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target)
      ) {
        setIsOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [isOpen])

  // Esc closes
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen])

  const handleCombinedChange = useCallback((e) => {
    const value = e.target.value
    setCombinedInput(value)
    const parsed = parseCoordinates(value)
    if (parsed) {
      setLatInput(parsed.lat)
      setLonInput(parsed.lon)
    }
  }, [])

  const handleCombinedBlur = useCallback(() => {
    const parsed = parseCoordinates(combinedInput)
    if (parsed) {
      onCommitLatLon(deployment.deploymentID, parsed.lat, parsed.lon)
    }
  }, [combinedInput, deployment.deploymentID, onCommitLatLon])

  const handleLatChange = useCallback((e) => {
    setLatInput(e.target.value)
  }, [])
  const handleLonChange = useCallback((e) => {
    setLonInput(e.target.value)
  }, [])

  const handleLatBlur = useCallback(() => {
    const lat = parseFloat(latInput)
    if (!Number.isNaN(lat)) {
      onCommitLatLon(deployment.deploymentID, lat, parseFloat(lonInput))
      setCombinedInput(`${lat}, ${lonInput}`)
    }
  }, [latInput, lonInput, deployment.deploymentID, onCommitLatLon])

  const handleLonBlur = useCallback(() => {
    const lon = parseFloat(lonInput)
    if (!Number.isNaN(lon)) {
      onCommitLatLon(deployment.deploymentID, parseFloat(latInput), lon)
      setCombinedInput(`${latInput}, ${lon}`)
    }
  }, [latInput, lonInput, deployment.deploymentID, onCommitLatLon])

  const handlePlaceClick = useCallback(() => {
    setIsOpen(false)
    onEnterPlaceMode(deployment)
  }, [deployment, onEnterPlaceMode])

  const handleClear = useCallback(() => {
    setLatInput('')
    setLonInput('')
    setCombinedInput('')
    onClearLatLon(deployment.deploymentID)
  }, [deployment.deploymentID, onClearLatLon])

  const buttonClass = useMemo(
    () =>
      `p-1 rounded ${
        isOpen
          ? 'bg-blue-50 text-blue-700'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      }`,
    [isOpen]
  )

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((v) => !v)}
        className={buttonClass}
        title="Edit location"
        aria-label="Edit location"
        aria-pressed={isOpen}
      >
        <MapPin size={16} />
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1 w-[300px] bg-white border border-gray-200 rounded-lg shadow-lg z-[1100] p-3"
        >
          <h5 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Location
          </h5>

          <div className="mb-2">
            <input
              type="text"
              value={combinedInput}
              onChange={handleCombinedChange}
              onBlur={handleCombinedBlur}
              placeholder="Paste lat, lon"
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="text-[10px] text-gray-400 mt-1">
              Paste from a spreadsheet, GPS, etc.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">
                Latitude
              </span>
              <input
                type="number"
                step="0.00001"
                min="-90"
                max="90"
                value={latInput ?? ''}
                onChange={handleLatChange}
                onBlur={handleLatBlur}
                className="px-2 py-1.5 border border-gray-300 rounded text-xs tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">
                Longitude
              </span>
              <input
                type="number"
                step="0.00001"
                min="-180"
                max="180"
                value={lonInput ?? ''}
                onChange={handleLonChange}
                onBlur={handleLonBlur}
                className="px-2 py-1.5 border border-gray-300 rounded text-xs tabular-nums"
              />
            </label>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
            <button
              onClick={handlePlaceClick}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded"
            >
              <MapPin size={12} />
              Place on map
            </button>
            <button
              onClick={handleClear}
              className="ml-auto text-xs text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 9.2: Lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 9.3: Commit**

```bash
git add src/renderer/src/deployments/LocationPopover.jsx
git commit -m "feat(deployments): add LocationPopover for lat/lon editing"
```

---

## Task 10: Wire LocationPopover into DeploymentDetailPane

**Files:**
- Modify: `src/renderer/src/deployments/DeploymentDetailPane.jsx`
- Modify: `src/renderer/src/deployments.jsx`

- [ ] **Step 10.1: Update DeploymentDetailPane to host the 📍 button**

Open `src/renderer/src/deployments/DeploymentDetailPane.jsx`. Update the props and header.

Replace the function signature:

```jsx
export default function DeploymentDetailPane({
  studyId,
  deployment,
  onClose,
  onRenameLocation,
  onCommitLatLon,
  onClearLatLon,
  onEnterPlaceMode
}) {
```

Add the import at the top:

```jsx
import LocationPopover from './LocationPopover'
```

Replace the icons div in the header (the inner `<div className="flex items-center gap-1 flex-shrink-0">`) with:

```jsx
<div className="flex items-center gap-1 flex-shrink-0">
  <LocationPopover
    deployment={deployment}
    onCommitLatLon={onCommitLatLon}
    onClearLatLon={onClearLatLon}
    onEnterPlaceMode={onEnterPlaceMode}
  />
  <SpeciesFilterButton
    studyId={studyId}
    deploymentID={deployment.deploymentID}
    selectedSpecies={selectedSpecies}
    onChange={setSelectedSpecies}
  />
  <button
    onClick={onClose}
    className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
    title="Close (Esc)"
    aria-label="Close media pane"
  >
    <X size={16} />
  </button>
</div>
```

- [ ] **Step 10.2: Pass the callbacks from Deployments**

In `src/renderer/src/deployments.jsx`, find the `DeploymentDetailPane` JSX (around line 1295). Add the new props:

```jsx
<DeploymentDetailPane
  key={paneSnapshot.deploymentID}
  studyId={studyId}
  deployment={paneSnapshot}
  onClose={() => setSelectedLocation(null)}
  onRenameLocation={onRenameLocation}
  onCommitLatLon={async (deploymentID, lat, lon) => {
    await onNewLatitude(deploymentID, lat)
    await onNewLongitude(deploymentID, lon)
  }}
  onClearLatLon={async (deploymentID) => {
    await onNewLatitude(deploymentID, null)
    await onNewLongitude(deploymentID, null)
  }}
  onEnterPlaceMode={handleEnterPlaceMode}
/>
```

Note: `handleEnterPlaceMode` already exists (around line 1117) and accepts a `location` argument.

- [ ] **Step 10.3: Verify `setDeploymentLatitude`/`Longitude` accept null**

Run: `grep -n "setDeploymentLatitude\|setDeploymentLongitude" src/main/ipc/deployments.js`

Open the file shown. Confirm the handlers accept and persist `NULL` for missing coordinates. If they coerce `null → 0` or reject null, **stop here** and surface this to the user — the spec assumes nullable coords; either the IPC needs a small fix or "Clear" must hide instead of nullify. Do not silently change behavior.

- [ ] **Step 10.4: Lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 10.5: Manual verification**

Run: `npm run dev`

Test scenarios:
- Click a deployment row → detail pane opens with 📍, filter, × buttons.
- Click 📍 → popover opens, shows current coords in all three fields.
- Paste `48.7384, -121.4521` into the combined field → both number inputs update.
- Edit latitude alone → combined field updates on blur, save fires.
- Click "Place on map" → popover closes, place-mode banner appears on big map, click on map sets coords.
- Click "Clear" → fields empty, IPC fires (verify the deployment loses its marker on the map).
- Esc closes the popover.
- Click outside closes the popover.

- [ ] **Step 10.6: Commit**

```bash
git add src/renderer/src/deployments/DeploymentDetailPane.jsx src/renderer/src/deployments.jsx
git commit -m "feat(deployments): wire LocationPopover into detail pane header"
```

---

## Task 11: Smoke test, docs, final regression check

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 11.1: Update architecture.md**

Open `docs/architecture.md`. Find the section that describes `src/renderer/src/deployments/`. Add the new files to the listing:

```
src/renderer/src/deployments/
├── coordinateParser.js     - Pure parser for "lat, lon" paste field
├── DeploymentDetailPane.jsx
├── EditableLocationName.jsx
├── groupDeployments.js     - Pure helper grouping deployments by location
├── LocationPopover.jsx     - Lat/lon editing popover
├── SectionHeader.jsx       - Always-expanded section header
├── Sparkline.jsx           - Bars/line/heatmap activity sparkline
├── SparklineToggle.jsx     - Per-study sparkline mode toggle
└── urlState.js
```

(Match whatever convention `architecture.md` already uses; if it doesn't list this directory in detail, just add a brief mention near the existing deployments-tab description.)

- [ ] **Step 11.2: Run the full test suite**

Run: `npm test`
Expected: PASS — pure-helper tests green, no regressions in existing tests.

- [ ] **Step 11.3: Lint, format check**

Run: `npm run lint && npm run format:check`
Expected: PASS

- [ ] **Step 11.4: Final manual smoke**

Run: `npm run dev`

Verify against the spec's testing list:

- List with 1 deployment → renders correctly, no section header.
- List with 5+ deployments mixing singletons and a multi-deploy group → alphabetical interleave, no "groups first" split.
- Sparkline toggle → cycle bars/line/heatmap, refresh page, persisted choice survives.
- Map↔list:
  - Click marker → row scrolls into view, highlights.
  - Click section header → map flies to bounds, no selection change.
  - Click already-selected row → deselect, pane closes.
- Lat/lon popover:
  - Open via 📍.
  - Paste, edit, place-on-map, clear all work.
  - Esc + click-outside both close.
- Resize the panel splits; rows reflow correctly.
- Switch studies; sparkline mode loads from the new study's localStorage.

- [ ] **Step 11.5: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: list new deployments/ components in architecture overview"
```

---

## Self-review notes

- **Spec coverage:**
  - Compact 40px rows → Task 6
  - Bars/line/heatmap sparkline → Task 3
  - Per-study toggle persisted → Task 4 + Task 7 (wired into header)
  - Always-expanded sections → Task 5 + Task 7
  - Alphabetical interleave sort → Task 2
  - Map↔list rules (marker = deployment, section header = bounds-fly, no selection change) → Tasks 7+8
  - Coordinate parser → Task 1
  - LocationPopover with paste / inputs / place / clear → Task 9
  - Detail pane gets 📍 button → Task 10
  - Inline lat/lon row inputs removed → Task 6
  - Section-collapse left as future work → Task 11 docs note (covered by spec's "Future work" section, not built here)

- **Type consistency:**
  - `groupDeploymentsByLocation` shape (`isSingleDeployment`, `aggregatedPeriods`, `deployments[]`) is consistent across Tasks 2, 5, 7.
  - `LocationPopover` callbacks (`onCommitLatLon`, `onClearLatLon`, `onEnterPlaceMode`) named identically across Tasks 9 and 10.
  - `useSparklineMode(studyId)` returns `[mode, setMode]` and is used consistently in Task 7.

- **No placeholders.** Each step has the actual code, exact paths, and concrete commands.
