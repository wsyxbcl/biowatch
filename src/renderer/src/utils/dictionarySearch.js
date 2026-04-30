import Fuse from 'fuse.js'
import dictionary from '../../../shared/commonNames/dictionary.json' with { type: 'json' }
import labelAliases from '../../../shared/commonNames/labelAliases.json' with { type: 'json' }

// Filter rules:
//  - Drop entries where commonName === scientificName. These are higher taxa
//    ("accipitridae family", "aburria species") and generic one-word names
//    ("badger", "bat") that we don't want to surface in a species picker.
//  - Drop label aliases (snake_case model labels that resolve to a canonical
//    binomial). Showing both the label entry and its canonical entry in the
//    picker produces visually duplicate rows like "yellow baboon
//    (yellow_baboon)" + "yellow baboon (papio cynocephalus)". The canonical
//    is the one users should pick; the label is internal-only.
const dictionaryEntries = Object.entries(dictionary)
  .filter(([sci, common]) => sci !== common)
  .filter(([sci]) => !(sci in labelAliases))
  .map(([scientificName, commonName]) => ({ scientificName, commonName }))

const fuseOptions = {
  keys: ['scientificName', 'commonName'],
  includeScore: true,
  threshold: 0.4,
  ignoreLocation: true
}

const dictionaryFuse = new Fuse(dictionaryEntries, fuseOptions)

export function searchSpecies(query, studySpeciesList) {
  if (!query || query.length < 3) {
    return studySpeciesList
  }

  const studyFuse = new Fuse(studySpeciesList, fuseOptions)
  const studyHits = studyFuse.search(query)
  const dictHits = dictionaryFuse.search(query)

  const merged = new Map()
  for (const { item, score } of studyHits) {
    merged.set(item.scientificName, { ...item, score: score * 0.7, inStudy: true })
  }
  for (const { item, score } of dictHits) {
    if (!merged.has(item.scientificName)) {
      merged.set(item.scientificName, { ...item, score, inStudy: false })
    }
  }

  return [...merged.values()].sort((a, b) => a.score - b.score).slice(0, 50)
}

// Exported for tests only.
export const _dictionaryEntries = dictionaryEntries
