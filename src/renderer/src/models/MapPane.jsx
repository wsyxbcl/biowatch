import { useEffect, useState, useMemo } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import { getRegion } from './regions'

const geojsonCache = new Map()

async function loadRegionGeoJSON(name) {
  if (geojsonCache.has(name)) return geojsonCache.get(name)
  const mod = await import(`../../../shared/regions/${name}.json`)
  const data = mod.default
  geojsonCache.set(name, data)
  return data
}

const WORLD_CENTER = [20, 0]

// Zoom level at which 256 × 2^z (= one world's pixel width) equals the
// container width. Result: tiles fill the container horizontally with no
// horizontal dead space; polar regions clip vertically.
function fillWidthZoom(containerWidthPx) {
  return Math.max(0, Math.log2(containerWidthPx / 256))
}

function MapController({ selectedId, regionalModels, geojsonByModel, worldwideId }) {
  const map = useMap()

  // On mount + on resize while worldwide is selected, fit world to width.
  useEffect(() => {
    if (selectedId !== worldwideId) return
    const fit = () => {
      const w = map.getSize().x
      if (w === 0) return
      map.setView(WORLD_CENTER, fillWidthZoom(w), { animate: false })
    }
    fit()
    map.on('resize', fit)
    return () => map.off('resize', fit)
  }, [selectedId, worldwideId, map])

  // Fly on selection change.
  useEffect(() => {
    if (!selectedId) return
    if (selectedId === worldwideId) {
      const w = map.getSize().x
      map.flyTo(WORLD_CENTER, fillWidthZoom(w), { duration: 0.6 })
      return
    }
    const regional = regionalModels.find((m) => m.reference.id === selectedId)
    if (!regional) return
    const data = geojsonByModel[regional.reference.id]
    if (!data) return
    const layer = L.geoJSON(data)
    map.flyToBounds(layer.getBounds(), { padding: [40, 40], duration: 0.6 })
  }, [selectedId, regionalModels, geojsonByModel, worldwideId, map])

  return null
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

  // Approximate initial zoom from window width — refined by MapController on mount.
  const initialZoom = useMemo(
    () => fillWidthZoom(typeof window !== 'undefined' ? window.innerWidth : 1024),
    []
  )

  return (
    <div
      className="relative bg-white rounded-xl border border-gray-200 shadow-md overflow-hidden w-full"
      style={{ aspectRatio: '2.8 / 1', minHeight: '220px' }}
    >
      {worldwideModel && (
        <button
          onClick={() => onSelect?.(worldwideModel.reference.id)}
          className={[
            'absolute top-2 left-2 z-[500] text-xs font-medium rounded-full px-3 py-1 shadow-sm border cursor-pointer transition-colors inline-flex items-center gap-1.5',
            selectedId === worldwideModel.reference.id
              ? 'bg-blue-50 text-blue-700 border-blue-300'
              : 'bg-white/95 text-gray-700 border-gray-200 hover:bg-gray-50'
          ].join(' ')}
        >
          <span aria-hidden>🌍</span>
          Worldwide model available
        </button>
      )}

      <MapContainer
        center={WORLD_CENTER}
        zoom={initialZoom}
        minZoom={0}
        maxZoom={10}
        zoomSnap={0}
        zoomDelta={0.5}
        maxBounds={[
          [-90, -180],
          [90, 180]
        ]}
        maxBoundsViscosity={1.0}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          noWrap={true}
          bounds={[
            [-90, -180],
            [90, 180]
          ]}
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
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
        <MapController
          selectedId={selectedId}
          regionalModels={regionalModels}
          geojsonByModel={geojsonByModel}
          worldwideId={worldwideModel?.reference.id}
        />
      </MapContainer>

      <div className="absolute bottom-2 left-2 z-[500] bg-white/90 rounded px-2 py-1 text-[10px] text-gray-700">
        Click a zone to see its model
      </div>
    </div>
  )
}
