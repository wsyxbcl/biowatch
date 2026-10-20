// Opt-in real-model test; private sample paths are supplied by the caller.
const { _electron: electron } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

async function main() {
  const samples = process.env.HEINISHI_SAMPLE_DIR
  assert.ok(samples && process.env.MAZE_JINGXI_BUNDLE_PATH && process.env.MAZE_JINGXI_PYTHON_PATH)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heinishi-e2e-'))
  const input = path.join(root, 'images')
  fs.mkdirSync(input)
  for (const name of ['P001.jpg', 'P067.jpg', 'P075.jpg'])
    fs.copyFileSync(path.join(samples, name), path.join(input, name))
  const video = process.env.HEINISHI_VIDEO_PATH
  if (video) fs.copyFileSync(video, path.join(input, `video${path.extname(video)}`))
  const expectedCount = video ? 4 : 3
  const errors = []
  const app = await electron.launch({
    args: [
      path.resolve('out/main/index.js'),
      `--user-data-dir=${path.join(root, 'user-data')}`,
      '--no-sandbox'
    ],
    env: { ...process.env, NODE_ENV: 'development', PYTHONDONTWRITEBYTECODE: '1' }
  })
  try {
    const page = await app.firstWindow()
    page.on('pageerror', (e) => errors.push(e.message))
    await page.waitForLoadState('domcontentloaded')
    const catalog = await page.evaluate(() => window.api.listAvailableModels())
    const model = catalog.find((m) => m.reference.id === 'maze-speciesnet-jingxi')
    assert.equal(model?.ready, true)
    assert.equal(model.reference.version, '0.0.1')
    await page.evaluate(() => {
      window.location.hash = '#/settings/ml_zoo'
    })
    await page.getByText('Heinishi Test type 001', { exact: true }).waitFor({ timeout: 15000 })
    await page.getByText('Heinishi Test type 001', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(root, 'models.png'), fullPage: true })
    const imported = await page.evaluate(
      ({ input, reference }) => window.api.selectImagesDirectoryWithModel(input, reference, null),
      { input, reference: model.reference }
    )
    console.log('IMPORT', JSON.stringify(imported))
    assert.ok(!imported.error && imported.success !== false)
    const deadline = Date.now() + 150000
    let result
    while (Date.now() < deadline) {
      const userData = await app.evaluate(({ app }) => app.getPath('userData'))
      const inspect = function (userData) {
        const fs = require('node:fs')
        const path = require('node:path')
        const Database = require('better-sqlite3')
        const studies = path.join(userData, 'biowatch-data', 'studies')
        if (!fs.existsSync(studies)) return null
        for (const id of fs.readdirSync(studies)) {
          const file = path.join(studies, id, 'study.db')
          if (!fs.existsSync(file)) continue
          const db = new Database(file, { readonly: true })
          try {
            const outputs = db.prepare('select rawOutput from model_outputs').all()
            const observations = db
              .prepare(
                'select scientificName, commonName, classificationProbability, detectionConfidence from observations'
              )
              .all()
            const jobs = db.prepare('select status, count(*) as n from jobs group by status').all()
            return { id, outputs, observations, jobs }
          } finally {
            db.close()
          }
        }
      }
      const code = `console.log(JSON.stringify((${inspect.toString()})(${JSON.stringify(userData)})))`
      result = JSON.parse(
        execFileSync(require('electron'), ['-e', code], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          encoding: 'utf8'
        })
      )
      if (
        result?.outputs.length === expectedCount &&
        result.jobs.some((j) => j.status === 'completed' && j.n === expectedCount)
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    assert.equal(result?.outputs.length, expectedCount, JSON.stringify(result))
    assert.deepEqual(result.jobs, [{ status: 'completed', n: expectedCount }])
    for (const output of result.outputs) {
      const raw = JSON.parse(output.rawOutput)
      for (const prediction of raw.frames ?? [raw]) {
        assert.equal(prediction.model_version, '0.0.1')
        assert.equal(prediction.jingxi.model_version, '0.1.0-experimental')
        assert.ok(prediction.jingxiTaxonomy.mappingId)
        if (process.env.HEINISHI_EXPECT_DEVICE)
          assert.equal(prediction.heinishiRuntime.device, process.env.HEINISHI_EXPECT_DEVICE)
      }
      if (raw.frames)
        assert.deepEqual(
          raw.frames.map((f) => f.frame_number),
          [0, 2, 4]
        )
    }
    assert.ok(result.observations.some((o) => o.scientificName === 'naemorhedus griseus'))
    assert.ok(
      result.observations.some(
        (o) => o.scientificName === 'animal' && o.classificationProbability === null
      )
    )
    // Heinishi stores Chinese names and supplies them as study vernacular names.
    assert.ok(
      result.observations.some(
        (o) => o.scientificName === 'naemorhedus griseus' && o.commonName === '中华斑羚'
      )
    )
    const study = await page.evaluate(
      (id) => window.api.getStudies().then((studies) => studies.find((s) => s.id === id)),
      result.id
    )
    const taxon = study.data.taxonomic?.find((t) => t.scientificName === 'sus scrofa')
    assert.equal(taxon?.vernacularNames.zho, '野猪')
    await page.evaluate((id) => {
      window.location.hash = `#/study/${id}/media`
    }, result.id)
    await page.getByText('中华斑羚').first().waitFor({ timeout: 15000 })
    await page.screenshot({ path: path.join(root, 'media.png'), fullPage: true })
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log(
      JSON.stringify(
        { root, id: result.id, observations: result.observations, jobs: result.jobs, errors },
        null,
        2
      )
    )
  } finally {
    await app.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
