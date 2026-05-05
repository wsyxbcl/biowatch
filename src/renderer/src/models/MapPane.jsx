import { useEffect, useState, useMemo } from 'react'
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet'
import { getRegion } from './regions'

const geojsonCache = new Map()

async function loadRegionGeoJSON(name) {
  if (geojsonCache.has(name)) return geojsonCache.get(name)
  const mod = await import(`../../../shared/regions/${name}.json`)
  const data = mod.default
  geojsonCache.set(name, data)
  return data
}

export default function MapPane({ modelZoo, selectedId, onSelect }) {
  const worldwideModel = useMemo(
    () => modelZoo.find((m) => m.region === 'worldwide'),
    [modelZoo]
  )
  const regionalModels = useMemo(
    () => modelZoo.filter((m) => m.region !== 'worldwide' && getRegion(m.region)?.geojson),
    [modelZoo]
  )

  const [geojsonByModel, setGeojsonByModel] = useState({})

  useEffect(() => {
    let cancelled = false
    Promise.all(
      regionalModels.map(async (m) => {
        const region = getRegion(m.region)
        const data = await loadRegionGeoJSON(region.geojson)
        return [m.reference.id, data]
      })
    ).then((entries) => {
      if (!cancelled) setGeojsonByModel(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [regionalModels])

  return (
    <div
      className="relative bg-white rounded-xl border border-gray-200 shadow-md overflow-hidden w-full"
      style={{ aspectRatio: '2.8 / 1', minHeight: '220px' }}
    >
      {worldwideModel && (
        <button
          onClick={() => onSelect?.(worldwideModel.reference.id)}
          className={[
            'absolute top-2 left-2 z-[500] text-xs font-semibold rounded-full px-3 py-1 shadow border-2 cursor-pointer',
            selectedId === worldwideModel.reference.id
              ? 'bg-indigo-500 text-white border-indigo-500'
              : 'bg-white/95 text-indigo-700 border-indigo-500 hover:bg-indigo-50'
          ].join(' ')}
        >
          🌍 Worldwide model available
        </button>
      )}

      <MapContainer
        center={[20, 20]}
        zoom={1}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        keyboard={false}
        attributionControl={false}
      >
        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
        {regionalModels.map((m) => {
          const region = getRegion(m.region)
          const data = geojsonByModel[m.reference.id]
          if (!data) return null
          const isSelected = selectedId === m.reference.id
          return (
            <GeoJSON
              key={`${m.reference.id}-${isSelected ? 'sel' : 'idle'}`}
              data={data}
              style={{
                color: region.color,
                weight: isSelected ? 3 : 2,
                fillColor: region.color,
                fillOpacity: isSelected ? 0.55 : 0.4
              }}
              eventHandlers={{
                click: () => onSelect?.(m.reference.id)
              }}
            />
          )
        })}
      </MapContainer>

      <div className="absolute bottom-2 left-2 z-[500] bg-white/90 rounded px-2 py-1 text-[10px] text-gray-700">
        Click a zone to see its model
      </div>
    </div>
  )
}
