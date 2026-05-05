const CLASS_DEFAULTS = {
  mammal:    { label: 'Mammals',    icon: '🦌' },
  bird:      { label: 'Birds',      icon: '🦅' },
  reptile:   { label: 'Reptiles',   icon: '🦎' },
  amphibian: { label: 'Amphibians', icon: '🐸' },
  other:     { label: 'Other',      icon: '🐟' }
}

export function filterSpecies(species, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return species
  return species.filter(
    (s) =>
      s.common.toLowerCase().includes(q) ||
      (s.scientific && s.scientific.toLowerCase().includes(q))
  )
}

export function classSummary(data) {
  const list = data.species || []

  if (list.length === 0 && data.summary) {
    return {
      total: data.summary.total,
      classes: data.summary.classes.map((c) => ({
        id: c.id,
        label: c.label,
        icon: c.icon,
        count: c.approx_count,
        approximate: true
      }))
    }
  }

  const hasClassField = list.length > 0 && list.every((s) => s.class)
  if (!hasClassField) {
    return { total: list.length, classes: null }
  }

  const counts = new Map()
  for (const s of list) {
    counts.set(s.class, (counts.get(s.class) || 0) + 1)
  }
  const classes = [...counts.entries()].map(([id, count]) => ({
    id,
    label: CLASS_DEFAULTS[id]?.label || id,
    icon: CLASS_DEFAULTS[id]?.icon || '•',
    count,
    approximate: false
  }))

  return { total: list.length, classes }
}
