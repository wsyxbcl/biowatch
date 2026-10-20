import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import csv from 'csv-parser'
import { normalizeScientificName } from '../src/shared/commonNames/normalize.js'

const sourceUrl = new URL('../resources/taxonomy/jingxi-taxa-gbif.csv', import.meta.url)
const mappingUrl = new URL('../resources/taxonomy/jingxi-delivery-mapping.json', import.meta.url)

export async function buildJingxiTaxonomy(source = null) {
  source ??= await readFile(sourceUrl, 'utf8')
  const mapping = JSON.parse(await readFile(mappingUrl, 'utf8'))
  const rows = []
  for await (const row of Readable.from([source]).pipe(
    csv({ mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '') })
  )) {
    if (row.source === 'model output') rows.push(row)
  }
  rows.sort((a, b) => Number(a.model_index) - Number(b.model_index))
  if (rows.length !== 26 || rows.some((r, i) => String(i) !== r.model_index))
    throw new Error('Invalid model index coverage')
  const entries = rows.map((r, i) => {
    if (r.raw_label !== mapping.entries[i].raw_label) throw new Error('Frozen label mismatch')
    if (!r.latin || !/^\d+$/.test(r.gbif_taxon_key)) throw new Error('Missing taxonomy identity')
    return {
      index: i,
      rawLabel: r.raw_label,
      displayLabel: r.display,
      chineseName: r.display.split(' · ')[0].trim(),
      scientificName: normalizeScientificName(r.latin),
      gbifKey: Number(r.gbif_taxon_key),
      sourceRank: r.rank,
      rank: i === 10 ? 'subspecies' : r.rank,
      status: i === 7 ? 'SYNONYM' : i === 16 ? 'HOMOTYPIC_SYNONYM' : 'ACCEPTED',
      acceptedKey: i === 7 ? 6164210 : i === 16 ? 2437450 : Number(r.gbif_taxon_key),
      acceptedName: i === 7 ? 'Canis lupus familiaris' : i === 16 ? 'Tamias sibiricus' : r.latin
    }
  })
  return {
    taxonomy: {
      id: 'heinishi-gbif-20261016',
      verifiedAt: '2026-10-16',
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      deliveryMappingId: mapping.mapping_id,
      entries
    },
    species: { species: rows.map((r) => ({ common: r.display, scientific: r.latin })) }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { taxonomy, species } = await buildJingxiTaxonomy()
  for (const [name, data] of [
    ['jingxi-taxonomy', taxonomy],
    ['jingxi', species]
  ]) {
    await writeFile(
      new URL(`../src/shared/species/${name}.json`, import.meta.url),
      JSON.stringify(data, null, 2) + '\n'
    )
  }
}
