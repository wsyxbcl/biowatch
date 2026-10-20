import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('builds exactly the 26 frozen outputs using GBIF identities', async () => {
  const { buildJingxiTaxonomy } = await import('../../scripts/build-jingxi-taxonomy.js')
  const result = await buildJingxiTaxonomy()
  assert.equal(result.taxonomy.entries.length, 26)
  assert.equal(result.species.species.length, 26)
  assert.equal(result.taxonomy.entries[10].scientificName, 'sus scrofa domesticus')
  assert.equal(result.taxonomy.entries[10].rank, 'subspecies')
  assert.equal(result.taxonomy.entries[22].scientificName, 'sus scrofa')
  assert.equal(result.taxonomy.entries[7].acceptedKey, 6164210)
  assert.equal(result.taxonomy.entries[21].scientificName, 'vulpes')
  assert.equal(result.taxonomy.entries[1].rawLabel, '其他鸟类')
  assert.equal(result.taxonomy.entries[22].chineseName, '野猪')
  assert.equal(result.taxonomy.entries[1].chineseName, '其他（非雉科）鸟类')
})

test('rejects duplicated indices and mismatched frozen labels', async () => {
  const { buildJingxiTaxonomy } = await import('../../scripts/build-jingxi-taxonomy.js')
  const csv = await readFile(
    new URL('../../resources/taxonomy/jingxi-taxa-gbif.csv', import.meta.url),
    'utf8'
  )
  await assert.rejects(buildJingxiTaxonomy(csv.replace('1,其他鸟类', '0,其他鸟类')), /index/)
  await assert.rejects(buildJingxiTaxonomy(csv.replace('0,中华斑羚', '0,wrong')), /label/)
})
