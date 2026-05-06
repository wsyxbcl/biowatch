#!/usr/bin/env node
/**
 * Build src/shared/speciesInfo/data.json by enriching the common-name
 * dictionary with GBIF (IUCN status) and Wikipedia (blurb + image).
 *
 * Usage:
 *   node scripts/build-species-info.js                  # full run
 *   node scripts/build-species-info.js --resume         # skip already-fetched
 *   node scripts/build-species-info.js --force          # refetch everything
 *   node scripts/build-species-info.js --limit 25       # cap candidates
 *   node scripts/build-species-info.js --dry-run        # don't write file
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

import {
  isSpeciesCandidate,
  parseGbifMatch,
  parseGbifIucn,
  parseWikipediaSummary
} from './build-species-info.lib.js'
import { buildAliasMap } from './lib/aliases.js'
import dictionary from '../src/shared/commonNames/dictionary.json' with { type: 'json' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUTPUT_PATH = path.join(ROOT, 'src/shared/speciesInfo/data.json')

const POLITE_DELAY_MS = 500
const RETRIES = 3
const RETRY_BASE_MS = 1000
const FLUSH_EVERY_N = 25

function parseArgs(argv) {
  const out = { resume: false, force: false, dryRun: false, limit: Infinity }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--resume') out.resume = true
    else if (a === '--force') out.force = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--limit') out.limit = Number(argv[++i])
    else throw new Error(`unknown flag: ${a}`)
  }
  return out
}

async function fetchJson(url) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'biowatch-species-info-builder' } })
      if (res.status === 404) return null
      if (res.status === 429) {
        // Honor Retry-After if Wikipedia/GBIF tells us how long to wait;
        // fall back to a generous backoff that covers their typical cooldown.
        const retryAfter = Number(res.headers.get('retry-after')) || 30
        if (attempt === RETRIES) throw new Error(`HTTP 429 (rate limited)`)
        await sleep(retryAfter * 1000)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      if (attempt === RETRIES) throw err
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
    }
  }
}

/**
 * Wikipedia REST sometimes returns a disambiguation page for genus/family
 * names (e.g. "Anser", "Ardea") because the bare title also refers to a city,
 * a constellation, etc. Retry with a rank-keyed suffix that points at the
 * taxonomic page — `<Name>_(genus)`, `<Name>_(bird)`, `<Name>_(family)` etc.
 * Returns the first non-disambig response, or the original disambig response
 * so the caller can still log it.
 */
async function fetchWikipediaSummaryWithRetries(name, rank) {
  const url = (title) =>
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  const first = await fetchJson(url(name))
  if (!first || first.type !== 'disambiguation') return first

  const suffixes = []
  if (rank === 'GENUS') suffixes.push('(genus)', '(bird)', '(plant)', '(fish)', '(insect)')
  else if (rank === 'FAMILY') suffixes.push('(family)', '(bird)', '(plant)')
  else if (rank === 'ORDER') suffixes.push('(order)', '(bird)', '(plant)')
  else if (rank === 'SUBFAMILY') suffixes.push('(subfamily)')

  for (const suffix of suffixes) {
    const titled = `${name.charAt(0).toUpperCase() + name.slice(1)} ${suffix}`
    const resp = await fetchJson(url(titled))
    if (resp && resp.type !== 'disambiguation') return resp
  }
  return first
}

const USEFUL_RANKS = new Set(['SPECIES', 'SUBSPECIES', 'GENUS', 'FAMILY', 'ORDER', 'SUBFAMILY'])

/**
 * Resolve a dictionary key to a GBIF taxon record. Three strategies, in order:
 *   1. /species/match with the lowercase key (works for binomials).
 *   2. /species/match with the first letter capitalized — GBIF is
 *      case-sensitive for higher-rank taxa ("anser" matches a UNRANKED
 *      synonym, while "Anser" returns the goose genus).
 *   3. /species/search with rank filters. Required when /species/match returns
 *      a useless KINGDOM/PHYLUM fallback (Gallus, Sciurus, Panthera) or
 *      "Multiple equal matches" (Anura). Iterates SPECIES → GENUS → FAMILY →
 *      ORDER and keeps the first ACCEPTED match whose canonical name equals
 *      the query.
 */
async function fetchGbifMatch(name) {
  const matchUrl = (n) => `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(n)}`
  const first = await fetchJson(matchUrl(name))
  if (first && USEFUL_RANKS.has(first.rank)) return first

  if (!/^[a-z]/.test(name)) return first
  const cap = name.charAt(0).toUpperCase() + name.slice(1)
  const second = await fetchJson(matchUrl(cap))
  if (second && USEFUL_RANKS.has(second.rank)) return second

  // Search-endpoint fallback. Restrict to Animalia + ACCEPTED, and require an
  // exact canonical-name match (case-insensitive) so we don't accidentally
  // pick up an unrelated taxon that merely contains the query string.
  for (const rank of ['GENUS', 'FAMILY', 'ORDER', 'SUBFAMILY']) {
    const data = await fetchJson(
      `https://api.gbif.org/v1/species/search?q=${encodeURIComponent(cap)}&rank=${rank}&status=ACCEPTED&kingdom=Animalia&limit=10`
    )
    const hit = data?.results?.find(
      (r) => r.canonicalName && r.canonicalName.toLowerCase() === name && r.rank === rank
    )
    if (hit) {
      return {
        usageKey: hit.key,
        canonicalName: hit.canonicalName,
        rank: hit.rank,
        scientificName: hit.scientificName,
        matchType: 'EXACT'
      }
    }
  }
  return first
}

async function fetchSpecies(name) {
  const match = await fetchGbifMatch(name)
  const verdict = parseGbifMatch(match)
  if (!verdict.accept) return { skip: verdict.reason }

  // allSettled so a Wikipedia 429 doesn't wipe out the IUCN value (or vice versa).
  const [iucnSettled, wikiSettled] = await Promise.allSettled([
    fetchJson(`https://api.gbif.org/v1/species/${verdict.usageKey}/iucnRedListCategory`),
    fetchWikipediaSummaryWithRetries(name, match.rank)
  ])

  const iucn = iucnSettled.status === 'fulfilled' ? parseGbifIucn(iucnSettled.value) : null
  const wiki =
    wikiSettled.status === 'fulfilled'
      ? parseWikipediaSummary(wikiSettled.value)
      : { blurb: null, imageUrl: null, wikipediaUrl: null }

  const errors = []
  if (iucnSettled.status === 'rejected') errors.push(`iucn: ${iucnSettled.reason.message}`)
  if (wikiSettled.status === 'rejected') errors.push(`wiki: ${wikiSettled.reason.message}`)

  const entry = {}
  if (iucn) entry.iucn = iucn
  if (wiki.blurb) entry.blurb = wiki.blurb
  if (wiki.imageUrl) entry.imageUrl = wiki.imageUrl
  if (wiki.wikipediaUrl) entry.wikipediaUrl = wiki.wikipediaUrl
  if (Object.keys(entry).length) {
    return { entry, partial: errors.length ? errors.join('; ') : null }
  }
  return { skip: errors.length ? errors.join('; ') : 'no usable fields' }
}

function loadExisting() {
  try {
    const text = fs.readFileSync(OUTPUT_PATH, 'utf8')
    return JSON.parse(text) || {}
  } catch {
    return {}
  }
}

/**
 * Mirror data.json entries from canonical scientific names onto their label
 * aliases. Pure copy — no extra GBIF/Wikipedia calls.
 */
function applyAliases(map) {
  const aliases = buildAliasMap()
  let mirrored = 0
  for (const [label, sci] of aliases) {
    if (label in map) continue
    if (sci in map) {
      map[label] = map[sci]
      mirrored++
    }
  }
  return mirrored
}

function writeOutput(map) {
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
  // Write to a temp file in the same directory, then rename — atomic on POSIX,
  // so a SIGKILL or power loss mid-write can't truncate the canonical file.
  const tmpPath = `${OUTPUT_PATH}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
  fs.renameSync(tmpPath, OUTPUT_PATH)
}

function diffSummary(prev, next) {
  const added = []
  const removed = []
  const changed = []
  for (const k of Object.keys(next)) {
    if (!(k in prev)) added.push(k)
    else if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) changed.push(k)
  }
  for (const k of Object.keys(prev)) {
    if (!(k in next)) removed.push(k)
  }
  return { added, removed, changed }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const existing = loadExisting()
  const out = { ...existing }

  const allKeys = Object.keys(dictionary)
  const candidates = allKeys.filter(isSpeciesCandidate)
  const skippedFilter = allKeys.length - candidates.length

  console.log(`dictionary: ${allKeys.length}, species candidates: ${candidates.length}`)
  console.log(`pre-filter skipped: ${skippedFilter}`)

  let processed = 0
  let kept = 0
  const skipReasons = new Map()
  const queue = candidates.slice(0, args.limit)

  // Install SIGINT/SIGTERM handlers so we flush partial work before exit.
  // SIGTERM is what `kill <pid>` sends by default — without this, killing
  // the script via the default signal would lose all in-flight progress.
  let interrupted = false
  const onSignal = (sig) => {
    interrupted = true
    console.log(`\n[${sig}] flushing progress and exiting...`)
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  for (const name of queue) {
    if (interrupted) break
    if (args.resume && !args.force && out[name]) continue
    processed++
    try {
      const result = await fetchSpecies(name)
      if (result.entry) {
        out[name] = result.entry
        kept++
        const tag = result.partial ? `[ok*]  ` : `[ok]   `
        console.log(`${tag}${name}${result.partial ? ` — partial: ${result.partial}` : ''}`)
      } else {
        skipReasons.set(result.skip, (skipReasons.get(result.skip) ?? 0) + 1)
        console.log(`[skip] ${name} — ${result.skip}`)
      }
    } catch (err) {
      console.warn(`[err]  ${name} — ${err.message}`)
    }

    // Periodic flush so a crash doesn't lose in-flight work. The pretty-print
    // is cheap (~600KB once full); for partial runs it's tiny.
    if (!args.dryRun && processed % FLUSH_EVERY_N === 0) {
      writeOutput(out)
      console.log(`[flush] wrote ${Object.keys(out).length} entries`)
    }

    await sleep(POLITE_DELAY_MS)
  }

  const { added, removed, changed } = diffSummary(existing, out)
  console.log('\n=== summary ===')
  console.log(`processed: ${processed}, kept: ${kept}`)
  for (const [r, n] of skipReasons) console.log(`skip "${r}": ${n}`)
  console.log(`diff vs previous: +${added.length} / -${removed.length} / ~${changed.length}`)

  const mirrored = applyAliases(out)
  if (mirrored) console.log(`mirrored ${mirrored} label-alias entries`)

  if (args.dryRun) {
    console.log('--dry-run: not writing file')
    return
  }
  writeOutput(out)
  console.log(`wrote ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
