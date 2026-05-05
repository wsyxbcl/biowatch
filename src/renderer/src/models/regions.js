export const REGIONS = {
  worldwide: {
    id: 'worldwide',
    label: 'Worldwide',
    color: '#6366f1',
    badgeBg: '#e0e7ff',
    badgeText: '#4338ca',
    geojson: null
  },
  europe: {
    id: 'europe',
    label: 'Europe',
    color: '#047857',
    badgeBg: '#d1fae5',
    badgeText: '#047857',
    geojson: 'europe.geojson'
  },
  himalayas: {
    id: 'himalayas',
    label: 'Himalayas',
    color: '#be185d',
    badgeBg: '#fce7f3',
    badgeText: '#be185d',
    geojson: 'himalayas.geojson'
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    color: '#a855f7',
    badgeBg: '#f3e8ff',
    badgeText: '#6b21a8',
    geojson: null
  }
}

export function getRegion(id) {
  return REGIONS[id] || null
}

export function withAlpha(hex, alpha) {
  const a = Math.max(0, Math.min(1, alpha))
  const byte = Math.round(a * 255).toString(16).padStart(2, '0')
  return `${hex}${byte}`
}
