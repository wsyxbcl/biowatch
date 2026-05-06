# Import/Export Pipelines

Data import and export workflows in Biowatch.

## Import Pipeline Overview

```
User Selection
      │
      ▼
┌─────────────────┐
│  File Dialog    │
│  or Drop Zone   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│   ZIP/Folder    │────►│    Extract      │
│   Detection     │     │    (if ZIP)     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│           Format Detection               │
│  ┌──────────┬──────────┬──────────┐     │
│  │ CamTrap  │ Wildlife │ DeepFaune│     │
│  │   DP     │ Insights │   CSV    │     │
│  └──────────┴──────────┴──────────┘     │
│  ┌──────────┬──────────┐                │
│  │   LILA   │   GBIF   │                │
│  │   COCO   │ CamtrapDP│                │
│  └──────────┴──────────┘                │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│             CSV Parsing                  │
│  - Stream large files                    │
│  - Transform to internal schema          │
│  - Validate required fields              │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│           Database Insert                │
│  - Batch inserts (1000 rows)            │
│  - Foreign key order: deployments →     │
│    media → observations                  │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│          Metadata Insert                 │
│  - Study UUID                           │
│  - Importer name                        │
│  - Contributors (JSON)                  │
└─────────────────────────────────────────┘
```

## CamTrap DP Import

**Format detection:** Looks for `datapackage.json` in directory.

**Process:**
1. Parse `datapackage.json` for metadata
2. Import CSVs in dependency order:
   - `deployments.csv` → deployments table
   - `media.csv` → media table
   - `observations.csv` → observations table
3. Transform file paths to absolute paths
4. Insert study metadata

**Key file:** `src/main/services/import/parsers/camtrapDP.js`

```javascript
// Import order matters for foreign keys
const filesToProcess = [
  { file: 'deployments.csv', table: deployments },
  { file: 'media.csv', table: media },
  { file: 'observations.csv', table: observations }
]
```

**Description sanitization.** Camtrap DP packages generated from GBIF/EML
metadata frequently contain DocBook inline markup (`<emphasis>`, `<para>`,
`<ulink url="…"><citetitle>…</citetitle></ulink>`, etc.) in the `description`
field. On import the description passes through
`src/main/services/import/sanitizeDescription.js`, which strips tags, decodes
common HTML entities, and rewrites `<ulink>` as `text (url)` so URLs survive
in the plain-text value stored in `studies.description`. The same helper is
applied to the Wildlife Insights `description` field as a no-op safety net.

## Wildlife Insights Import

**Format detection:** Looks for `projects.csv` in directory.

**Process:**
1. Parse `projects.csv` for study metadata
2. Import `deployments.csv` → deployments table
3. Import `images.csv` → both media AND observations tables
4. Generate observation IDs as `{image_id}_obs`
5. Construct scientificName from `genus + species`

**Key file:** `src/main/services/import/parsers/wildlifeInsights.js`

## LILA Dataset Import

**Format:** COCO Camera Traps JSON (from lila.science datasets)

**Process (small datasets <100K images):**
```
┌─────────────────┐
│  Select Dataset │
│  from Whitelist │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Download JSON  │
│  Metadata       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Parse COCO     │
│  Camera Traps   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│           Schema Mapping                 │
│  images[].location → deploymentID       │
│  images[].datetime → deploymentStart/End│
│    (MIN/MAX per location)               │
│  images[].file_name → HTTP URL          │
│  annotations[] + categories[] →         │
│    observations with normalized bbox    │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│           Database Insert               │
│  - Batch inserts (1000 rows)           │
│  - Images loaded via HTTP at runtime   │
└─────────────────────────────────────────┘
```

**Process (large datasets ≥100K images - Streaming):**

For large datasets like Snapshot Serengeti (7.1M images), a streaming architecture is used to avoid memory exhaustion:

```
┌─────────────────┐
│  Select Dataset │
│  from Whitelist │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Download JSON  │
│  (keep on disk) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│       Pass 1: Stream Categories          │
│  - Extract categories array              │
│  - Build category lookup map             │
│  - Memory: ~10MB                         │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│       Pass 2: Stream Images (5K chunks)  │
│  - Insert media to main DB               │
│  - Store image metadata in temp SQLite   │
│  - Compute sequence bounds incrementally │
│  - Compute deployment bounds             │
│  - Memory: ~100MB peak                   │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│   Pass 3: Stream Annotations (5K chunks) │
│  - Query temp DB for image metadata      │
│  - Transform to observations             │
│  - Insert to main DB                     │
│  - Memory: ~100MB peak                   │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│       Pass 4: Finalize                   │
│  - Insert deployments from temp DB       │
│  - Clean up temp database                │
│  - Insert study metadata                 │
└─────────────────────────────────────────┘
```

**Supported Datasets (24 total):**
- Biome Health Project Maasai Mara 2018 (37K images, Kenya)
- Snapshot Karoo (38K images, South Africa)
- Snapshot Serengeti (7.1M images, Tanzania) - uses streaming
- WCS Camera Traps (1.4M images, 675 species)
- NACTI (3.7M images)
- And 19 more...

**Key features:**
- Images loaded remotely via HTTP (no local download)
- COCO bbox normalized from pixels to 0-1 coordinates
- ZIP metadata extraction supported (e.g., Snapshot Karoo)
- Deployment temporal bounds derived from MIN/MAX image datetimes per location
- NaN values in JSON sanitized to null (handles Python/NumPy exports)
- **Streaming import for large datasets (≥100K images)** using:
  - `stream-json` library for memory-efficient JSON parsing
  - Temporary SQLite database for intermediate storage
  - Chunked processing (5000 records at a time)
  - WAL mode enabled for better write performance
- Sequence information imported (seq_id → eventID with eventStart/eventEnd bounds)
- `media.importFolder` is set to the dataset name (e.g., `"Snapshot Serengeti"`) so the Sources tab can group LILA media into a single source row.

**Key files:**
- `src/main/services/import/parsers/lila.js` — orchestrator
- `src/main/services/import/parsers/lila-helpers.js` — pure mapping helpers (testable without electron)

```javascript
// COCO bbox normalization
function normalizeBbox(bbox, imageWidth, imageHeight) {
  if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) return null
  const [x, y, width, height] = bbox
  return {
    bboxX: x / imageWidth,
    bboxY: y / imageHeight,
    bboxWidth: width / imageWidth,
    bboxHeight: height / imageHeight
  }
}

// Streaming threshold - datasets with more images use streaming
const STREAMING_THRESHOLD = 100000  // 100K images
```

## Image Folder Import with ML

Most complex import pipeline with streaming ML inference.

```
┌─────────────────┐
│  Select Folder  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Scan for       │
│  Images (EXIF)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create Study DB │
│ + Model Run     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Batch Images   │────►│  HTTP Server    │
│  (5 at a time)  │     │  POST /predict  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │◄──────────────────────┘
         │  Streaming predictions
         ▼
┌─────────────────┐
│  Parse & Store  │
│  - modelOutputs │
│  - observations │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Update Status  │
│  (progress %)   │
└─────────────────┘
```

**Key file:** `src/main/services/import/importer.js`

### Video Timestamp Extraction

For images, timestamps are extracted from EXIF metadata (`DateTimeOriginal`, `CreateDate`, `MediaCreateDate`) using the `exifr` library. However, `exifr` does not support video container formats (MP4, MOV, AVI), so a dedicated fallback chain is used for video files:

1. **FFmpeg container metadata** — Reads `creation_time` from the video container using the bundled FFmpeg binary
2. **Filename pattern parsing** — Recognizes common camera trap naming conventions (e.g., `RCNX0001_20240315_143022.MP4`, `VID_20240315_143022.mp4`)
3. **File modification time** — Last resort fallback using filesystem mtime. Note: mtime may be unreliable when files are copied from SD cards. FAT32/exFAT (common on camera trap SD cards) stores timestamps at 2-second resolution in local time without timezone info, so copying across timezones can shift the time. Some copy tools or SD card readers may also reset timestamps entirely. This is why mtime is used only as a last resort.

Each extracted timestamp is validated to reject known-bad values: QuickTime epoch (1904-01-01), Unix epoch (1970-01-01), pre-2000 dates, and future dates. The source of the extracted timestamp is stored in `exifData.timestampSource` for auditability.

**Key file:** `src/main/services/import/timestamp.js`

### Prediction Flow

```javascript
// Streaming predictions generator
async function* getPredictions({ imagesPath, port, signal }) {
  const response = await fetch(`http://localhost:${port}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: imagesPath.map((path) => ({ filepath: path }))
    }),
    signal
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    // Parse newline-delimited JSON
    const chunk = decoder.decode(value)
    const lines = chunk.trim().split('\n')
    for (const line of lines) {
      if (line.trim()) {
        const response = JSON.parse(line)
        for (const pred of response.output.predictions) {
          yield pred
        }
      }
    }
  }
}
```

### Bbox Transformation

Different models output bboxes differently. All are normalized to CamTrap DP format:

```javascript
// src/main/utils/bbox.js

// SpeciesNet: [x_min, y_min, x_max, y_max] → CamTrap DP
function transformSpeciesNetBbox(bbox) {
  const [x_min, y_min, x_max, y_max] = bbox
  return {
    bboxX: x_min,
    bboxY: y_min,
    bboxWidth: x_max - x_min,
    bboxHeight: y_max - y_min
  }
}

// DeepFaune: [x_center, y_center, width, height] → CamTrap DP
function transformDeepFauneBbox(bbox) {
  const [x_center, y_center, width, height] = bbox
  return {
    bboxX: x_center - width / 2,
    bboxY: y_center - height / 2,
    bboxWidth: width,
    bboxHeight: height
  }
}
```

---

## Export Pipeline Overview

```
Export Request
      │
      ▼
┌─────────────────┐
│  Select Dest    │
│  Directory      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Query Data     │
│  (with filters) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│           Export Type                    │
│  ┌──────────────┬──────────────────┐    │
│  │  CamTrap DP  │  Image Directories│    │
│  └──────────────┴──────────────────┘    │
└────────────────────┬────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  Generate CSV   │     │  Copy/Download  │
│  + JSON files   │     │  Media Files    │
└─────────────────┘     └─────────────────┘
```

## CamTrap DP Export

**Options:**
- `includeMedia` - Copy media files to export
- `selectedSpecies` - Filter to specific species
- `includeBlank` - Include blank observations
- `sequenceGap` - Sequence grouping gap in seconds (default: 0)
  - When `0` (Off): Preserves existing `eventID`, `eventStart`, `eventEnd` from database (imported values)
  - When `> 0`: Generates new sequences by grouping observations within the gap threshold per deployment
  - Generated eventID format: `{deploymentID}_seq_{paddedIndex}` (e.g., `CAM001_seq_0001`)

**Output structure:**
```
export/
├── datapackage.json
├── deployments.csv
├── media.csv
├── observations.csv
└── media/              # If includeMedia=true
    ├── image1.jpg
    └── ...
```

**Key file:** `src/main/services/export/exporter.js`

### datapackage.json Generation

```javascript
function generateDataPackage(studyId, studyName, metadata) {
  return {
    name: slugify(studyName),
    title: metadata?.title || studyName,
    description: metadata?.description || 'Camera trap dataset exported from Biowatch',
    version: '1.0.0',
    created: new Date().toISOString(),
    contributors: metadata?.contributors || [{ title: 'Biowatch User', role: 'author' }],
    licenses: [{
      name: 'CC-BY-4.0',
      path: 'https://creativecommons.org/licenses/by/4.0/'
    }],
    profile: 'tabular-data-package',
    resources: [/* CSV schemas */]
  }
}
```

## Activity Map PNG Export

Saves the Activity tab's species distribution map (Leaflet basemap + pie chart markers + legend) as a PNG file. Triggered from a right-click context menu on the map.

**Flow:**

1. Renderer (`src/renderer/src/activity.jsx` → `SpeciesMap`) listens for Leaflet's `contextmenu` event via a `useMapEvents` controller.
2. Right-click renders a small fixed-position menu (`src/renderer/src/ui/ActivityMapContextMenu.jsx`) with **Save map as PNG…**.
3. On click, `html-to-image` rasterises `map.getContainer()` at `pixelRatio: 2` with a filter that strips the zoom and layer-toggle controls (attribution stays for OSM/Esri compliance).
4. The base64 PNG data URL is sent to main via `window.api.exportActivityMapPng({ dataUrl, defaultFilename })`.
5. Main (`src/main/ipc/activity.js`) shows `dialog.showSaveDialog`, then `fs.promises.writeFile`s the decoded buffer.

**Default filename:** `activity-map-<study-slug>-<YYYY-MM-DD>.png`, written to the OS Downloads folder unless the user picks elsewhere.

**Tile CORS:** both `<TileLayer>` components in `SpeciesMap` set `crossOrigin=""` so the Esri World_Imagery and OSM tiles can be rendered onto the canvas without tainting it.

## Image Directory Export

Organizes images into species-named folders.

**Options:**
- `selectedSpecies` - Which species to export
- `includeBlank` - Create `blank/` folder

**Output structure:**
```
export/
├── Vulpes vulpes/
│   ├── image1.jpg
│   └── image2.jpg
├── Canis lupus/
│   └── image3.jpg
└── blank/
    └── image4.jpg
```

## Parallel File Processing

Both exports use parallel file processing for performance:

```javascript
const DOWNLOAD_CONCURRENCY = 5

async function processFilesInParallel(files, processFile, tracker, concurrency) {
  let currentIndex = 0

  const workers = Array(Math.min(concurrency, files.length))
    .fill(null)
    .map(async () => {
      while (currentIndex < files.length) {
        if (activeExport.isCancelled) break

        const index = currentIndex++
        const file = files[index]

        try {
          await processFile(file, index, tracker)
          tracker.incrementProcessed()
        } catch (error) {
          tracker.incrementError()
        }
      }
    })

  await Promise.all(workers)
}
```

## Progress Tracking

Export progress is reported via IPC events:

```javascript
// Main process sends progress
sendExportProgress({
  type: 'file',
  currentFile: 150,
  totalFiles: 1000,
  fileName: 'IMG_0042.jpg',
  speciesName: 'Vulpes vulpes',
  isDownloading: true,
  downloadPercent: 45,
  errorCount: 2,
  estimatedTimeRemaining: 120,  // seconds
  overallPercent: 15
})

// Renderer listens
const unsubscribe = window.api.onExportProgress((progress) => {
  setProgress(progress)
})
```

## Remote File Handling

Exports handle both local and remote (HTTP) file paths:

```javascript
function isRemoteUrl(filePath) {
  return filePath && (filePath.startsWith('http://') || filePath.startsWith('https://'))
}

// In processFile:
if (isRemote) {
  await downloadFileWithRetry(sourcePath, destPath, onProgress)
} else {
  await fs.copyFile(sourcePath, destPath)
}
```

## Remote Image Caching (Best Captures)

Remote images from GBIF, Agouti, and LILA imports are cached to disk for offline access and performance. This caching is **automatic and transparent** - no user action required.

**How it works:**

1. When Best Captures carousel displays remote images, it uses the `cached-image://` protocol
2. Main process checks if image is already cached
3. If cached → serves from local disk (instant)
4. If not cached → redirects to original URL + triggers background download
5. Next view → serves from cache

**Cache characteristics:**
- **Location:** `{userData}/biowatch-data/studies/{studyId}/cache/images/`
- **Key:** SHA256 hash of URL (first 16 characters)
- **Expiration:** 30 days (auto-cleaned at app startup)
- **Strategy:** Lazy caching (on first display, not eagerly)

**Key file:** `src/main/services/cache/image.js`

```javascript
// Protocol flow
// 1. Renderer loads: cached-image://cache?studyId=X&url=https://example.com/img.jpg
// 2. Main process:
//    - Check cache: {studyId}/cache/images/{hash}_img.jpg
//    - If exists: serve from disk
//    - If not: redirect to original URL, start background download
```

## Cancellation

### Export Cancellation

Exports support cancellation:

```javascript
// Request cancellation
await window.api.cancelExport()

// In export loop
if (activeExport.isCancelled) {
  break
}
```

### Import Cancellation (GBIF & LILA)

GBIF and LILA imports support cancellation via `AbortController`. When cancelled, the partially created study database is deleted.

```javascript
// Cancel active GBIF import (datasetKey must match the active import)
await window.api.cancelGbifImport(datasetKey)

// Cancel active LILA import (datasetId must match the active import)
await window.api.cancelLilaImport(datasetId)
```

The cancellation signal (`AbortSignal`) is threaded through the entire pipeline:
- **Downloads**: Aborts the fetch reader loop in `downloadFileWithRetry`
- **Extraction**: Destroys the unzipper read stream in `extractZip`
- **Database imports**: Checked between batch inserts (every 1000-2000 rows)

On cancellation:
1. The active operation throws an `AbortError`
2. The study database is closed and its directory is deleted
3. Temporary download/extraction files are cleaned up
4. A `stage: 'cancelled'` progress event is sent to the renderer

---

## Key Files

| File | Purpose |
|------|---------|
| `src/main/services/import/parsers/camtrapDP.js` | CamTrap DP import |
| `src/main/services/import/parsers/wildlifeInsights.js` | Wildlife Insights import |
| `src/main/services/import/parsers/deepfaune.js` | DeepFaune CSV import |
| `src/main/services/import/parsers/lila.js` | LILA dataset import (COCO Camera Traps) |
| `src/main/services/import/parsers/lila-helpers.js` | Pure helpers for LILA mapping (testable in isolation) |
| `src/main/services/import/importer.js` | Image folder import with ML |
| `src/main/services/import/timestamp.js` | Video timestamp extraction with fallback chain |
| `src/main/services/import/index.js` | Re-exports all import functions |
| `src/main/services/export/exporter.js` | All export functionality |
| `src/main/services/download.ts` | File download with retry |
| `src/main/utils/bbox.js` | Bbox format conversions |
| `src/main/services/cache/image.js` | Remote image caching for Best Captures |
| `src/main/services/cache/cleanup.js` | Cache expiration cleanup |
