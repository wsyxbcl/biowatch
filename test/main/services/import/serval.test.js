import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import fs from 'fs'
import csv from 'csv-parser'

import {
  buildServalTaxonomyResolver,
  findServalTaglistPath,
  importServalDatasetWithPath
} from '../../../../src/main/services/import/parsers/serval.js'

describe('Serval taxonomy resolver', () => {
  const resolver = buildServalTaxonomyResolver([
    {
      tag: 'Alpine accentor',
      mazeScientificName: 'Prunella collaris',
      mazeNameCN: '领岩鹨'
    },
    {
      tag: 'Blank',
      mazeScientificName: 'Blank',
      mazeNameCN: '无动物'
    },
    {
      tag: '',
      mazeScientificName: 'Anas zonorhyncha',
      mazeNameCN: '斑嘴鸭'
    },
    {
      tag: 'Snake spp.',
      mazeScientificName: '',
      mazeNameCN: '蛇类'
    }
  ])

  test('resolves English tag labels to normalized scientific names', () => {
    assert.deepEqual(resolver.resolve(' Alpine   Accentor '), {
      matched: true,
      blank: false,
      scientificName: 'prunella collaris',
      commonName: 'alpine accentor',
      sourceLabel: 'Alpine accentor'
    })
  })

  test('resolves Chinese labels through mazeNameCN', () => {
    assert.deepEqual(resolver.resolve('领岩鹨'), {
      matched: true,
      blank: false,
      scientificName: 'prunella collaris',
      commonName: 'alpine accentor',
      sourceLabel: 'Alpine accentor'
    })
  })

  test('resolves mixed English and Chinese Serval labels', () => {
    assert.deepEqual(resolver.resolve('Alpine accentor 领岩鹨'), {
      matched: true,
      blank: false,
      scientificName: 'prunella collaris',
      commonName: 'alpine accentor',
      sourceLabel: 'Alpine accentor'
    })
  })

  test('drops incomplete taxonomy rows from the alias map', () => {
    assert.deepEqual(resolver.resolve('斑嘴鸭'), {
      matched: false,
      blank: false,
      scientificName: '斑嘴鸭',
      commonName: '斑嘴鸭',
      sourceLabel: '斑嘴鸭'
    })

    assert.deepEqual(resolver.resolve('Snake spp.'), {
      matched: false,
      blank: false,
      scientificName: 'snake spp.',
      commonName: 'Snake spp.',
      sourceLabel: 'Snake spp.'
    })
  })

  test('maps blank taxonomy rows to Biowatch blank observations', () => {
    assert.deepEqual(resolver.resolve('无动物'), {
      matched: true,
      blank: true,
      scientificName: null,
      commonName: null,
      sourceLabel: 'Blank'
    })
  })
})

describe('Serval CSV import', () => {
  test('imports tags.csv through a sidecar three-column serval taglist', async () => {
    const root = join(tmpdir(), 'biowatch-serval-test', Date.now().toString())
    const inputDir = join(root, 'input')
    const biowatchDataPath = join(root, 'biowatch-data')
    mkdirSync(inputDir, { recursive: true })

    try {
      const tagsPath = join(inputDir, 'tags.csv')
      writeFileSync(
        tagsPath,
        [
          'path,deployment,time,species,event_id',
          'images/a.jpg,cam1,2024-01-02 03:04:05,领岩鹨,event-1',
          'images/b.jpg,cam1,2024-01-02 03:05:05,Blank,event-2',
          'images/c.jpg,cam2,2024-01-03 04:05:06,Alpine accentor,event-3'
        ].join('\n')
      )
      writeFileSync(
        join(inputDir, 'serval-taglist.csv'),
        [
          'tag,mazeScientificName,mazeNameCN',
          'Alpine accentor,Prunella collaris,领岩鹨',
          'Blank,Blank,无动物'
        ].join('\n')
      )

      const result = await importServalDatasetWithPath(tagsPath, biowatchDataPath, 'study-serval')

      assert.equal(result.data.importerName, 'serval/csv')

      const dbPath = join(biowatchDataPath, 'studies', 'study-serval', 'study.db')
      assert.equal(existsSync(dbPath), true)

      const db = new Database(dbPath, { readonly: true })
      try {
        const observations = db
          .prepare(
            `SELECT scientificName, commonName, observationType, count, eventID
             FROM observations
             ORDER BY eventID`
          )
          .all()

        assert.deepEqual(observations, [
          {
            scientificName: 'prunella collaris',
            commonName: 'alpine accentor',
            observationType: 'animal',
            count: 1,
            eventID: 'event-1'
          },
          {
            scientificName: null,
            commonName: null,
            observationType: 'blank',
            count: 0,
            eventID: 'event-2'
          },
          {
            scientificName: 'prunella collaris',
            commonName: 'alpine accentor',
            observationType: 'animal',
            count: 1,
            eventID: 'event-3'
          }
        ])

        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM media').get().count, 3)
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM deployments').get().count, 2)
      } finally {
        db.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('bundled Serval taglist', () => {
  test('resolves the bundled taglist from the current working directory', () => {
    const root = join(tmpdir(), 'biowatch-serval-cwd-test', Date.now().toString())
    const inputDir = join(root, 'input')
    const bundledDir = join(root, 'resources', 'taxonomy')
    const originalCwd = process.cwd()

    mkdirSync(inputDir, { recursive: true })
    mkdirSync(bundledDir, { recursive: true })

    try {
      const tagsPath = join(inputDir, 'tags.csv')
      const taglistPath = join(bundledDir, 'serval-taglist.csv')
      writeFileSync(tagsPath, 'path,deployment,time,species,event_id\n')
      writeFileSync(
        taglistPath,
        ['tag,mazeScientificName,mazeNameCN', 'Blank,Blank,无动物'].join('\n')
      )

      process.chdir(root)

      assert.equal(findServalTaglistPath(tagsPath), taglistPath)
    } finally {
      process.chdir(originalCwd)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('ships as a complete three-column Biowatch-compatible CSV', async () => {
    const taglistPath = join(process.cwd(), 'resources', 'taxonomy', 'serval-taglist.csv')
    assert.equal(existsSync(taglistPath), true, 'Bundled Serval taglist should exist')

    const rows = await new Promise((resolve, reject) => {
      const parsedRows = []
      fs.createReadStream(taglistPath)
        .pipe(csv())
        .on('headers', (headers) => {
          assert.deepEqual(headers, ['tag', 'mazeScientificName', 'mazeNameCN'])
        })
        .on('data', (row) => parsedRows.push(row))
        .on('end', () => resolve(parsedRows))
        .on('error', reject)
    })

    assert(rows.length > 0, 'Bundled Serval taglist should contain taxonomy rows')
    for (const row of rows) {
      assert(row.tag.trim(), 'tag should be present')
      assert(row.mazeScientificName.trim(), 'mazeScientificName should be present')
      assert(row.mazeNameCN.trim(), 'mazeNameCN should be present')
    }
    assert(
      rows.some(
        (row) =>
          row.tag === 'Blank' && row.mazeScientificName === 'Blank' && row.mazeNameCN === '无动物'
      ),
      'Bundled Serval taglist should include the Blank mapping'
    )
  })
})
