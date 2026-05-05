import { useEffect, useMemo, useState } from 'react'
import { filterSpecies, classSummary } from './speciesPanelHelpers'

const SMALL_LIST_THRESHOLD = 50

const speciesCache = new Map()

async function loadSpecies(name) {
  if (speciesCache.has(name)) return speciesCache.get(name)
  const mod = await import(`../../../shared/species/${name}.json`)
  const data = mod.default
  speciesCache.set(name, data)
  return data
}

export default function SpeciesPanel({ model }) {
  const [data, setData] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    loadSpecies(model.species_data).then((d) => {
      if (!cancelled) setData(d)
    })
    return () => {
      cancelled = true
    }
  }, [model.species_data])

  if (!data) {
    return (
      <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200 text-xs text-gray-500">
        Loading species…
      </div>
    )
  }

  const total = data.summary?.total ?? data.species.length
  const isLarge = total > SMALL_LIST_THRESHOLD

  return (
    <div
      className="mt-2 p-2 bg-gray-50 rounded border border-gray-200"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="text"
        placeholder={isLarge ? 'Search any species…' : 'Filter species…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full px-2 py-1 text-xs border border-gray-300 rounded mb-2 bg-white"
      />
      {isLarge ? (
        <LargeView data={data} query={query} />
      ) : (
        <SmallView data={data} query={query} />
      )}
    </div>
  )
}

function SmallView({ data, query }) {
  const filtered = useMemo(() => filterSpecies(data.species, query), [data.species, query])
  if (filtered.length === 0) {
    return <div className="text-xs text-gray-500 italic">No matches.</div>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {filtered.map((s) => (
        <span
          key={s.scientific || s.common}
          className="text-[10px] bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-700"
          title={s.scientific}
        >
          {s.common}
        </span>
      ))}
    </div>
  )
}

function LargeView({ data, query }) {
  const summary = useMemo(() => classSummary(data), [data])
  const filtered = useMemo(
    () => filterSpecies(data.species || [], query),
    [data.species, query]
  )

  if (query.trim()) {
    if (filtered.length === 0) {
      return <div className="text-xs text-gray-500 italic">No matches.</div>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {filtered.slice(0, 100).map((s) => (
          <span
            key={s.scientific || s.common}
            className="text-[10px] bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-700"
            title={s.scientific}
          >
            {s.common}
          </span>
        ))}
        {filtered.length > 100 && (
          <span className="text-[10px] text-gray-500 italic px-2 py-0.5">
            …and {filtered.length - 100} more
          </span>
        )}
      </div>
    )
  }

  if (!summary.classes) {
    return <div className="text-xs text-gray-500 italic">No taxonomic data available.</div>
  }

  return (
    <div className="flex flex-col gap-1">
      {summary.classes.map((c) => (
        <div
          key={c.id}
          className="flex justify-between items-center px-2 py-1 text-xs hover:bg-white rounded"
        >
          <span>
            {c.icon} {c.label}
          </span>
          <span className="text-gray-500 text-[10px]">
            {c.approximate ? '~' : ''}
            {c.count}
          </span>
        </div>
      ))}
    </div>
  )
}
