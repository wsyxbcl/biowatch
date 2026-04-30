import { useEffect, useRef, useState } from 'react'
import ReactDOMServer from 'react-dom/server'
import L from 'leaflet'
import { LayersControl, MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { Camera, MapPin } from 'lucide-react'
import PlaceholderMap from './ui/PlaceholderMap'
import { useImportStatus } from '@renderer/hooks/import'
import { useQuery } from '@tanstack/react-query'
import { useSequenceGap } from './hooks/useSequenceGap'
import EditorialHeader from './overview/EditorialHeader'
import KpiBand from './overview/KpiBand'
import BestCapturesSection from './overview/BestCapturesSection'
import SpeciesDistribution from './overview/SpeciesDistribution'

// ──────────────────────────────────────────────────────────────────────────
// DeploymentMap — kept here for now. Self-contained.
// ──────────────────────────────────────────────────────────────────────────

function LayerChangeHandler({ onLayerChange }) {
  const map = useMap()
  useEffect(() => {
    const handle = (e) => onLayerChange(e.name)
    map.on('baselayerchange', handle)
    return () => map.off('baselayerchange', handle)
  }, [map, onLayerChange])
  return null
}

function FitBoundsOnResize({ bounds }) {
  const map = useMap()
  const boundsRef = useRef(bounds)

  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])

  useEffect(() => {
    const container = map.getContainer()
    const userInteracted = { current: false }
    const markInteracted = () => {
      userInteracted.current = true
    }
    container.addEventListener('mousedown', markInteracted)
    container.addEventListener('wheel', markInteracted, { passive: true })
    container.addEventListener('touchstart', markInteracted, { passive: true })
    container.addEventListener('keydown', markInteracted)

    const observer = new ResizeObserver(() => {
      map.invalidateSize()
      if (!userInteracted.current && boundsRef.current) {
        map.fitBounds(boundsRef.current, { padding: [30, 30] })
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      container.removeEventListener('mousedown', markInteracted)
      container.removeEventListener('wheel', markInteracted)
      container.removeEventListener('touchstart', markInteracted)
      container.removeEventListener('keydown', markInteracted)
    }
  }, [map])

  return null
}

const createClusterCustomIcon = (cluster) => {
  const count = cluster.getChildCount()
  let size = 'small'
  if (count >= 10) size = 'medium'
  if (count >= 50) size = 'large'

  const sizeClasses = {
    small: 'w-8 h-8 text-xs',
    medium: 'w-10 h-10 text-sm',
    large: 'w-12 h-12 text-base'
  }

  const icon = L.divIcon({
    html: `<div class="flex items-center justify-center ${sizeClasses[size]} bg-blue-500 text-white rounded-full border-2 border-white shadow-lg font-semibold">${count}</div>`,
    className: 'custom-cluster-icon',
    iconSize: L.point(40, 40, true)
  })

  cluster.options.title = ''
  cluster.unbindTooltip()
  cluster.bindTooltip(`${count} deployments`, { direction: 'top', offset: [0, -15] })

  return icon
}

function DeploymentMap({ deployments, studyId }) {
  const mapLayerKey = `mapLayer:${studyId}`
  const [selectedLayer, setSelectedLayer] = useState(() => {
    const saved = localStorage.getItem(mapLayerKey)
    return saved || 'Satellite'
  })

  useEffect(() => {
    localStorage.setItem(mapLayerKey, selectedLayer)
  }, [selectedLayer, mapLayerKey])

  if (!deployments || deployments.length === 0) {
    return (
      <PlaceholderMap
        title="No Deployment Data"
        description="Set up deployments in the Deployments tab to see camera trap locations on this map."
        linkTo="/deployments"
        linkText="Go to Deployments"
        icon={MapPin}
        studyId={studyId}
      />
    )
  }

  const valid = deployments.filter((d) => d.latitude && d.longitude)

  if (valid.length === 0) {
    return (
      <PlaceholderMap
        title="No Geographic Coordinates"
        description="Set up deployment coordinates in the Deployments tab to see camera trap locations on this map."
        linkTo="/deployments"
        linkText="Go to Deployments"
        icon={MapPin}
        studyId={studyId}
      />
    )
  }

  const positions = valid.map((d) => [parseFloat(d.latitude), parseFloat(d.longitude)])
  const bounds = L.latLngBounds(positions)

  const formatDate = (s) => {
    if (!s) return 'N/A'
    return new Date(s).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const cameraIcon = L.divIcon({
    html: ReactDOMServer.renderToString(
      <div className="camera-marker">
        <Camera color="#1E40AF" fill="#93C5FD" size={28} />
      </div>
    ),
    className: 'custom-camera-icon',
    iconSize: [18, 18],
    iconAnchor: [14, 14]
  })

  return (
    <div className="w-full h-full bg-white rounded border border-gray-200">
      <MapContainer
        key={studyId}
        bounds={bounds}
        boundsOptions={{ padding: [30, 30] }}
        style={{ height: '100%', width: '100%' }}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer name="Satellite" checked={selectedLayer === 'Satellite'}>
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Street Map" checked={selectedLayer === 'Street Map'}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        <LayerChangeHandler onLayerChange={setSelectedLayer} />
        <FitBoundsOnResize bounds={bounds} />
        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterCustomIcon}
          maxClusterRadius={50}
          spiderfyOnMaxZoom
          showCoverageOnHover={false}
          zoomToBoundsOnClick
          polygonOptions={{ opacity: 0 }}
          singleMarkerMode={false}
        >
          {valid.map((d) => (
            <Marker
              key={d.deploymentID}
              position={[parseFloat(d.latitude), parseFloat(d.longitude)]}
              icon={cameraIcon}
            >
              <Popup>
                <div>
                  <h3 className="text-base font-semibold">
                    {d.locationName || d.locationID || 'Unnamed Location'}
                  </h3>
                  <p className="text-sm">
                    {formatDate(d.deploymentStart)} - {formatDate(d.deploymentEnd)}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Overview — the editorial showcase tab.
// ──────────────────────────────────────────────────────────────────────────

export default function Overview({ data, studyId, studyName }) {
  const { importStatus } = useImportStatus(studyId)
  const { sequenceGap } = useSequenceGap(studyId)

  const { data: deploymentsData, error: deploymentsError } = useQuery({
    queryKey: ['deploymentLocations', studyId],
    queryFn: async () => {
      const response = await window.api.getDeploymentLocations(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    refetchInterval: importStatus?.isRunning ? 5000 : false
  })

  const { data: speciesData, error: speciesError } = useQuery({
    queryKey: ['sequenceAwareSpeciesDistribution', studyId, sequenceGap],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareSpeciesDistribution(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId && sequenceGap !== undefined,
    refetchInterval: importStatus?.isRunning ? 5000 : false,
    placeholderData: (prev) => prev,
    staleTime: Infinity
  })

  const error = speciesError?.message || deploymentsError?.message || null

  return (
    <div className="flex flex-col px-6 gap-6 h-full overflow-y-auto overflow-x-hidden py-4">
      <EditorialHeader
        studyId={studyId}
        studyName={studyName}
        studyData={data}
        mapSlot={<DeploymentMap key={studyId} deployments={deploymentsData} studyId={studyId} />}
      />

      <KpiBand studyId={studyId} studyData={data} isImporting={importStatus?.isRunning} />

      <BestCapturesSection studyId={studyId} isRunning={importStatus?.isRunning} />

      <SpeciesDistribution
        studyId={studyId}
        speciesData={speciesData}
        taxonomicData={data?.taxonomic || null}
      />

      {error && <div className="text-red-500 text-sm">Error: {error}</div>}
    </div>
  )
}
