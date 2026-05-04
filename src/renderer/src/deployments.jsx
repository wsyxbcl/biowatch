import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Camera, MapPin, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOMServer from 'react-dom/server'
import { LayersControl, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSearchParams } from 'react-router'
import { useImportStatus } from '@renderer/hooks/import'
import SkeletonDeploymentsList from './ui/SkeletonDeploymentsList'
import { resolveSelectedDeployment, withDeploymentParam } from './deployments/urlState'
import DeploymentDetailPane from './deployments/DeploymentDetailPane'
import EditableLocationName from './deployments/EditableLocationName'
import { groupDeploymentsByLocation } from './deployments/groupDeployments'
import Sparkline from './deployments/Sparkline'
import SectionHeader from './deployments/SectionHeader'
import SparklineToggle from './deployments/SparklineToggle'
import { useSparklineMode } from './hooks/useSparklineMode'

// Fix the default marker icon issue in react-leaflet
// This is needed because the CSS assets are not properly loaded
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png'
})

// Add style block for marker styles
const markerStyles = `
  .invisible-drag-marker {
    background: transparent !important;
    border: none !important;
    cursor: move;
  }

  .camera-marker-active {
    position: relative;
    cursor: move;
  }

  .marker-ring {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 48px;
    height: 48px;
    border: 3px solid #3B82F6;
    border-radius: 50%;
    animation: pulse-ring 1.5s ease-out infinite;
    pointer-events: none;
  }

  @keyframes pulse-ring {
    0% {
      transform: translate(-50%, -50%) scale(0.7);
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -50%) scale(1.3);
      opacity: 0;
    }
  }

  .camera-marker-active svg {
    filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.7));
  }

  .custom-camera-icon {
    background: transparent !important;
    border: none !important;
  }

  /* Soft fade + slide-up when the detail pane mounts; symmetric fade-out
     before unmount via [data-state="closing"]. Kept under 200ms so it
     never gets in the way of rapid deployment switching. */
  @keyframes detail-pane-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes detail-pane-out {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(8px); }
  }
  .detail-pane-anim[data-state="open"] {
    animation: detail-pane-in 180ms ease-out;
  }
  .detail-pane-anim[data-state="closing"] {
    animation: detail-pane-out 150ms ease-in forwards;
  }
`

// Add the style to the document head
if (typeof document !== 'undefined' && !document.getElementById('marker-styles')) {
  const style = document.createElement('style')
  style.id = 'marker-styles'
  style.textContent = markerStyles
  document.head.appendChild(style)
}

// Create camera icons once at module level for better performance
const createCameraIcon = (isActive) => {
  const cameraIcon = ReactDOMServer.renderToString(
    <div className={isActive ? 'camera-marker-active' : 'camera-marker'}>
      {isActive && <div className="marker-ring"></div>}
      {isActive ? (
        <Camera color="#1E40AF" fill="#93C5FD" size={32} />
      ) : (
        <Camera color="#777" fill="#bbb" size={28} />
      )}
    </div>
  )

  return L.divIcon({
    html: cameraIcon,
    className: 'custom-camera-icon',
    iconSize: isActive ? [32, 32] : [18, 18],
    iconAnchor: isActive ? [16, 16] : [14, 14]
  })
}

const cameraIcon = createCameraIcon(false)
const activeCameraIcon = createCameraIcon(true)

// Custom cluster icon creator
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

  // Remove default title and replace with tooltip
  cluster.options.title = ''
  cluster.unbindTooltip()
  cluster.bindTooltip(`${count} deployments`, { direction: 'top', offset: [0, -15] })

  return icon
}

// Component to handle map layer change events for persistence
function LayerChangeHandler({ onLayerChange }) {
  const map = useMap()
  useEffect(() => {
    const handleBaseLayerChange = (e) => {
      onLayerChange(e.name)
    }
    map.on('baselayerchange', handleBaseLayerChange)
    return () => map.off('baselayerchange', handleBaseLayerChange)
  }, [map, onLayerChange])
  return null
}

// Component to handle map events for place mode
function MapEventHandler({ isPlaceMode, onMapClick }) {
  useMapEvents({
    click: (e) => {
      if (isPlaceMode) {
        onMapClick(e.latlng)
      }
    }
  })
  return null
}

// Component that calls map.invalidateSize() whenever the map's container resizes.
// Required when the map sits inside a resizable panel — Leaflet caches its size
// and won't repaint tiles correctly without this.
function InvalidateOnResize() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [map])
  return null
}

// Component to fly to selected location
function FlyToSelected({ selectedLocation }) {
  const map = useMap()

  useEffect(() => {
    if (selectedLocation?.latitude && selectedLocation?.longitude) {
      map.flyTo(
        [parseFloat(selectedLocation.latitude), parseFloat(selectedLocation.longitude)],
        16, // zoom level
        { duration: 0.8 }
      )
    }
  }, [selectedLocation, map])

  return null
}

// Component to provide an imperative API for flying to bounds
function FlyToBoundsHandler({ flyToRef }) {
  const map = useMap()
  useEffect(() => {
    if (!flyToRef) return
    flyToRef.current = (bounds) => {
      map.flyToBounds(bounds, { duration: 0.8, padding: [40, 40] })
    }
    return () => {
      flyToRef.current = null
    }
  }, [map, flyToRef])
  return null
}

// Draggable marker component that manually controls dragging via ref
// This is needed because react-leaflet v5 doesn't properly update the draggable prop dynamically
function DraggableMarker({
  location,
  isSelected,
  onSelect,
  onDragEnd,
  isPlaceMode,
  onExitPlaceMode
}) {
  const markerRef = useRef(null)
  const tooltipName = location.locationName || location.locationID

  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return

    // Control dragging
    if (marker.dragging) {
      if (isSelected) {
        marker.dragging.enable()
      } else {
        marker.dragging.disable()
      }
    }

    // Control tooltip - unbind existing and rebind with correct permanent state
    marker.unbindTooltip()
    marker.bindTooltip(tooltipName, {
      direction: 'top',
      offset: [0, -15],
      permanent: isSelected
    })
  }, [isSelected, tooltipName])

  return (
    <Marker
      ref={markerRef}
      position={[parseFloat(location.latitude), parseFloat(location.longitude)]}
      icon={isSelected ? activeCameraIcon : cameraIcon}
      draggable={true}
      zIndexOffset={isSelected ? 1000 : 0}
      eventHandlers={{
        add: (e) => {
          const marker = e.target
          // Disable dragging immediately when marker is added if not selected
          if (!isSelected && marker.dragging) {
            marker.dragging.disable()
          }
          // Bind tooltip on add with correct permanent state
          marker.bindTooltip(tooltipName, {
            direction: 'top',
            offset: [0, -15],
            permanent: isSelected
          })
        },
        click: () => {
          if (isPlaceMode) {
            onExitPlaceMode()
          }
          onSelect(location)
        },
        dragend: (e) => {
          const marker = e.target
          const position = marker.getLatLng()
          onDragEnd(position.lat.toFixed(6), position.lng.toFixed(6))
        }
      }}
    />
  )
}

function LocationMap({
  locations,
  selectedLocation,
  setSelectedLocation,
  onNewLatitude,
  onNewLongitude,
  isPlaceMode,
  onPlaceLocation,
  onExitPlaceMode,
  flyToRef, // wired in Task 8 — accepted here to avoid prop-spreading lint
  studyId
}) {
  const mapRef = useRef(null)

  // Persist map layer selection per study
  const mapLayerKey = `mapLayer:${studyId}`
  const [selectedLayer, setSelectedLayer] = useState(() => {
    const saved = localStorage.getItem(mapLayerKey)
    return saved || 'Satellite'
  })

  useEffect(() => {
    localStorage.setItem(mapLayerKey, selectedLayer)
  }, [selectedLayer, mapLayerKey])

  // Escape key handler to exit place mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isPlaceMode) {
        onExitPlaceMode()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPlaceMode, onExitPlaceMode])

  // Memoize valid locations filter
  const validLocations = useMemo(
    () => locations.filter((location) => location.latitude && location.longitude),
    [locations]
  )

  // Memoize bounds calculation
  const bounds = useMemo(() => {
    if (validLocations.length === 0) return null
    const positions = validLocations.map((location) => [
      parseFloat(location.latitude),
      parseFloat(location.longitude)
    ])
    return L.latLngBounds(positions)
  }, [validLocations])

  return (
    <div className="w-full h-full bg-white rounded-xl border border-gray-200 shadow-md overflow-hidden relative">
      <MapContainer
        {...(bounds
          ? { bounds: bounds, boundsOptions: { padding: [30, 30] } }
          : { center: [0, 0], zoom: 2 })}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef}
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

        {/* Repaint Leaflet whenever the panel housing the map is resized */}
        <InvalidateOnResize />

        {/* Fly to selected location when it changes */}
        <FlyToSelected selectedLocation={selectedLocation} />

        {/* Provides imperative API to fly to bounds when section header is clicked */}
        <FlyToBoundsHandler flyToRef={flyToRef} />

        {/* Map event handler for place mode */}
        <MapEventHandler isPlaceMode={isPlaceMode} onMapClick={onPlaceLocation} />

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
          {validLocations.map((location) => (
            <DraggableMarker
              key={location.deploymentID}
              location={location}
              isSelected={selectedLocation?.deploymentID === location.deploymentID}
              onSelect={setSelectedLocation}
              onDragEnd={(lat, lng) => {
                if (selectedLocation) {
                  onNewLatitude(selectedLocation.deploymentID, lat)
                  onNewLongitude(selectedLocation.deploymentID, lng)
                }
              }}
              isPlaceMode={isPlaceMode}
              onExitPlaceMode={onExitPlaceMode}
            />
          ))}
        </MarkerClusterGroup>
      </MapContainer>

      {/* Place mode indicator */}
      {isPlaceMode && selectedLocation && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[1000]">
          <div className="bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium flex items-center gap-2">
            <MapPin size={16} />
            <span>
              Click to place: {selectedLocation?.locationName || selectedLocation?.locationID}
            </span>
            <button
              onClick={onExitPlaceMode}
              className="ml-2 hover:bg-blue-700 rounded-full p-1"
              title="Cancel (Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Memoized deployment row component
const DeploymentRow = memo(function DeploymentRow({
  location,
  isSelected,
  onSelect,
  onRenameLocation,
  sparklineMode,
  percentile90Count,
  indented = false
}) {
  const handleRowClick = useCallback(() => onSelect(location), [location, onSelect])
  const total = (location.periods || []).reduce((sum, p) => sum + (p.count || 0), 0)

  return (
    <div
      id={location.deploymentID}
      title={location.deploymentStart}
      onClick={handleRowClick}
      className={`flex gap-3 items-center px-3 h-10 hover:bg-gray-200 cursor-pointer border-b border-gray-100 transition-colors ${
        indented ? 'pl-9 bg-[#fcfcfd]' : ''
      } ${
        isSelected
          ? `bg-blue-50 border-l-4 border-l-blue-500 ${indented ? 'pl-8' : 'pl-2'}`
          : 'border-l-4 border-l-transparent'
      }`}
    >
      <div className="w-[140px] min-w-0">
        <EditableLocationName
          locationID={location.locationID}
          locationName={location.locationName}
          isSelected={isSelected}
          onRename={onRenameLocation}
        />
      </div>

      <div className="flex-1 min-w-0">
        <Sparkline
          periods={location.periods}
          mode={sparklineMode}
          percentile90Count={percentile90Count}
        />
      </div>

      <div className="flex-shrink-0 w-16 text-right text-xs text-gray-500 tabular-nums">
        {total.toLocaleString()}
      </div>
    </div>
  )
})

// Generate evenly-spaced date markers for timeline
const getDateMarkers = (startDate, endDate, count = 5) => {
  if (!startDate || !endDate) return []
  const start = new Date(startDate)
  const end = new Date(endDate)
  const step = (end - start) / (count - 1)
  return Array.from({ length: count }, (_, i) => new Date(start.getTime() + step * i))
}

// Format date as "Jan 24" for timeline markers
const formatDateShort = (date) => {
  return date.toLocaleDateString('en-US', { year: '2-digit', month: 'short' })
}

function LocationsList({
  studyId,
  activity,
  selectedLocation,
  setSelectedLocation,
  onRenameLocation,
  onSectionClick,
  onPeriodCountChange
}) {
  const parentRef = useRef(null)
  const timelineRef = useRef(null)
  const [timelineWidth, setTimelineWidth] = useState(0)
  const [sparklineMode, setSparklineMode] = useSparklineMode(studyId)

  useEffect(() => {
    const node = timelineRef.current
    if (!node) return
    const ro = new ResizeObserver(([entry]) => {
      setTimelineWidth(entry.contentRect.width)
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const dateCount = timelineWidth ? Math.max(2, Math.min(15, Math.round(timelineWidth / 150))) : 5
  const periodCount = timelineWidth ? Math.max(10, Math.round(timelineWidth / 30 / 10) * 10) : 20

  useEffect(() => {
    onPeriodCountChange?.(periodCount)
  }, [periodCount, onPeriodCountChange])

  const locationGroups = useMemo(
    () => groupDeploymentsByLocation(activity.deployments),
    [activity.deployments]
  )

  const virtualItems = useMemo(() => {
    const items = []
    locationGroups.forEach((group) => {
      if (group.isSingleDeployment) {
        items.push({ type: 'single', deployment: group.deployments[0], group })
      } else {
        items.push({ type: 'group-header', group })
        group.deployments.forEach((deployment) => {
          items.push({ type: 'group-deployment', deployment, group })
        })
      }
    })
    return items
  }, [locationGroups])

  const dateMarkers = useMemo(
    () => getDateMarkers(activity.startDate, activity.endDate, dateCount),
    [activity.startDate, activity.endDate, dateCount]
  )

  const rowVirtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (virtualItems[index].type === 'group-header' ? 36 : 40),
    overscan: 8
  })

  useEffect(() => {
    if (!selectedLocation) return
    const index = virtualItems.findIndex((item) => {
      if (item.type === 'single' || item.type === 'group-deployment') {
        return item.deployment.deploymentID === selectedLocation.deploymentID
      }
      return false
    })
    if (index !== -1) {
      rowVirtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' })
    }
  }, [selectedLocation, virtualItems, rowVirtualizer])

  if (!activity.deployments || activity.deployments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="text-gray-400 mb-3">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
        <p className="text-gray-500 font-medium">No deployments found</p>
        <p className="text-gray-400 text-sm mt-1">Import deployment data to see camera locations</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <header className="bg-white z-10 py-2 border-b border-gray-300 flex items-stretch">
        {/* Date markers stretch across the activity column. The 212px
            left gutter matches the row's name column + leading padding;
            the 16px right gutter matches the count column; toggle on
            the far right. */}
        <div className="w-[152px] flex-shrink-0" />
        <div ref={timelineRef} className="flex-1 flex justify-between text-xs text-gray-600">
          {dateMarkers.map((date, i) => (
            <div key={i} className="flex flex-col items-center flex-1 min-w-0">
              <span>{formatDateShort(date)}</span>
              <div className="w-px h-2 bg-gray-400 mt-1" />
            </div>
          ))}
        </div>
        <div className="w-16 flex-shrink-0" />
        <div className="px-2 flex items-center">
          <SparklineToggle mode={sparklineMode} onChange={setSparklineMode} />
        </div>
      </header>

      <div ref={parentRef} className="flex-1 overflow-auto min-h-0">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = virtualItems[virtualRow.index]
            const isSelectedDeployment = (deployment) =>
              deployment && selectedLocation?.deploymentID === deployment.deploymentID
            const sectionHasSelection = (group) =>
              group.deployments.some((d) => d.deploymentID === selectedLocation?.deploymentID)

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                {item.type === 'single' && (
                  <DeploymentRow
                    location={item.deployment}
                    isSelected={isSelectedDeployment(item.deployment)}
                    onSelect={setSelectedLocation}
                    onRenameLocation={onRenameLocation}
                    sparklineMode={sparklineMode}
                    percentile90Count={activity.percentile90Count}
                  />
                )}

                {item.type === 'group-header' && (
                  <SectionHeader
                    group={item.group}
                    sparklineMode={sparklineMode}
                    percentile90Count={activity.percentile90Count}
                    isSelected={sectionHasSelection(item.group)}
                    onRenameLocation={onRenameLocation}
                    onSectionClick={onSectionClick}
                  />
                )}

                {item.type === 'group-deployment' && (
                  <DeploymentRow
                    location={item.deployment}
                    isSelected={isSelectedDeployment(item.deployment)}
                    onSelect={setSelectedLocation}
                    onRenameLocation={onRenameLocation}
                    sparklineMode={sparklineMode}
                    percentile90Count={activity.percentile90Count}
                    indented
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function Deployments({ studyId }) {
  const [isPlaceMode, setIsPlaceMode] = useState(false)
  // Bucketed period count, set by LocationsList from its measured timeline
  // width. Drives the SQL aggregation; null until the timeline measures itself.
  const [periodCount, setPeriodCount] = useState(null)
  const queryClient = useQueryClient()
  const { importStatus } = useImportStatus(studyId)
  const [searchParams, setSearchParams] = useSearchParams()

  // Lightweight un-deduped query for the map — one marker per deployment so
  // MarkerClusterGroup correctly counts co-located deployments. The deduped
  // getDeploymentLocations would be wrong here because dragging the single
  // "representative" marker silently splits a co-located group.
  const { data: deploymentsList } = useQuery({
    queryKey: ['deploymentsAll', studyId],
    queryFn: async () => {
      const response = await window.api.getAllDeployments(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    refetchInterval: () => (importStatus?.isRunning ? 5000 : false),
    enabled: !!studyId
  })

  // Selected deployment is mirrored in ?deploymentID=… so deep links round-trip
  // and back/forward navigation works. We resolve from the loaded deployments
  // list so an invalid/stale id (deleted deployment, wrong study) collapses to
  // null without throwing.
  const selectedLocation = useMemo(
    () => resolveSelectedDeployment(searchParams, deploymentsList),
    [searchParams, deploymentsList]
  )
  // Once the deployments list has loaded, drop a stale ?deploymentID=… that
  // doesn't match any deployment (study switch, deleted row, bad link).
  // Keeps the URL honest and avoids a lingering param across navigation.
  useEffect(() => {
    if (Array.isArray(deploymentsList) && searchParams.get('deploymentID') && !selectedLocation) {
      setSearchParams(withDeploymentParam(searchParams, null), { replace: true })
    }
  }, [deploymentsList, selectedLocation, searchParams, setSearchParams])
  // Toggle-off when clicking the already-selected deployment: clearing the
  // selection closes the media pane. Map markers reuse the same path, so
  // clicking the active marker also deselects.
  const setSelectedLocation = useCallback(
    (location) => {
      const nextID =
        location && location.deploymentID === selectedLocation?.deploymentID
          ? null
          : (location?.deploymentID ?? null)
      setSearchParams(withDeploymentParam(searchParams, nextID), { replace: true })
    },
    [searchParams, setSearchParams, selectedLocation]
  )

  // Heavy per-deployment period-bucket query for the list timeline. Runs in
  // the sequences worker so the SUM(CASE) × N aggregate over observations
  // doesn't block the UI. periodCount is set by LocationsList from the
  // measured timeline width (bucketed to multiples of 10) so wider screens
  // get more circles per row; placeholderData holds the previous bucket's
  // rows during the bucket-crossing refetch (v5 idiom — keepPreviousData was
  // removed in @tanstack/react-query v5).
  const { data: activity, isLoading: isActivityLoading } = useQuery({
    queryKey: ['deploymentsActivity', studyId, periodCount],
    queryFn: async () => {
      const response = await window.api.getDeploymentsActivity(studyId, periodCount)
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    placeholderData: (prev) => prev,
    refetchInterval: () => (importStatus?.isRunning ? 5000 : false),
    enabled: !!studyId
  })

  const onNewLatitude = useCallback(
    async (deploymentID, latitude) => {
      try {
        const lat = parseFloat(latitude)
        const result = await window.api.setDeploymentLatitude(studyId, deploymentID, lat)

        // Optimistic update via queryClient. Use setQueriesData (plural) with
        // a prefix key so we patch every periodCount variant cached for this
        // study, since periodCount is part of the full query key.
        queryClient.setQueriesData(
          { queryKey: ['deploymentsActivity', studyId] },
          (prevActivity) => {
            if (!prevActivity) return prevActivity
            const updatedDeployments = prevActivity.deployments.map((deployment) => {
              if (deployment.deploymentID === deploymentID) {
                return { ...deployment, latitude: lat }
              }
              return deployment
            })
            return { ...prevActivity, deployments: updatedDeployments }
          }
        )

        // Also patch the un-deduped map cache so the dragged marker doesn't
        // snap back during the post-invalidation refetch.
        queryClient.setQueryData(['deploymentsAll', studyId], (prev) => {
          if (!prev) return prev
          return prev.map((d) => (d.deploymentID === deploymentID ? { ...d, latitude: lat } : d))
        })

        if (result.error) {
          console.error('Error updating latitude:', result.error)
        } else {
          // Invalidate the Overview tab's (deduped) deployments cache so its map updates
          queryClient.invalidateQueries({ queryKey: ['deploymentLocations', studyId] })
          // Invalidate this tab's un-deduped cache
          queryClient.invalidateQueries({ queryKey: ['deploymentsAll', studyId] })
          // Invalidate the Activity tab's heatmap cache so map updates
          queryClient.invalidateQueries({ queryKey: ['heatmapData', studyId] })
        }
      } catch (error) {
        console.error('Error updating latitude:', error)
      }
    },
    [studyId, queryClient]
  )

  const onNewLongitude = useCallback(
    async (deploymentID, longitude) => {
      try {
        const lng = parseFloat(longitude)
        const result = await window.api.setDeploymentLongitude(studyId, deploymentID, lng)

        // Optimistic update via queryClient (matches all periodCount variants).
        queryClient.setQueriesData(
          { queryKey: ['deploymentsActivity', studyId] },
          (prevActivity) => {
            if (!prevActivity) return prevActivity
            const updatedDeployments = prevActivity.deployments.map((deployment) => {
              if (deployment.deploymentID === deploymentID) {
                return { ...deployment, longitude: lng }
              }
              return deployment
            })
            return { ...prevActivity, deployments: updatedDeployments }
          }
        )

        queryClient.setQueryData(['deploymentsAll', studyId], (prev) => {
          if (!prev) return prev
          return prev.map((d) => (d.deploymentID === deploymentID ? { ...d, longitude: lng } : d))
        })

        if (result.error) {
          console.error('Error updating longitude:', result.error)
        } else {
          queryClient.invalidateQueries({ queryKey: ['deploymentLocations', studyId] })
          queryClient.invalidateQueries({ queryKey: ['deploymentsAll', studyId] })
          queryClient.invalidateQueries({ queryKey: ['heatmapData', studyId] })
        }
      } catch (error) {
        console.error('Error updating longitude:', error)
      }
    },
    [studyId, queryClient]
  )

  const handleEnterPlaceMode = useCallback(
    (location) => {
      // The popover only opens when a deployment is selected, so the
      // deployment argument should equal the current selection. Set
      // selection only if it differs (avoid the toggle-off case where
      // re-selecting clears the URL param and place mode loses anchor).
      if (location && location.deploymentID !== selectedLocation?.deploymentID) {
        setSelectedLocation(location)
      }
      setIsPlaceMode(true)
    },
    [selectedLocation, setSelectedLocation]
  )

  const handleExitPlaceMode = useCallback(() => {
    setIsPlaceMode(false)
  }, [])

  const handlePlaceLocation = useCallback(
    (latlng) => {
      if (selectedLocation) {
        onNewLatitude(selectedLocation.deploymentID, latlng.lat.toFixed(6))
        onNewLongitude(selectedLocation.deploymentID, latlng.lng.toFixed(6))
        setIsPlaceMode(false)
      }
    },
    [selectedLocation, onNewLatitude, onNewLongitude]
  )

  const sectionFlyToRef = useRef(null)

  const handleSectionClick = useCallback((group) => {
    // Fly map to bounds of the group's children. Selection is unchanged.
    const positions = group.deployments
      .filter((d) => d.latitude != null && d.longitude != null)
      .map((d) => [parseFloat(d.latitude), parseFloat(d.longitude)])
    if (positions.length === 0) return
    const bounds = L.latLngBounds(positions)
    sectionFlyToRef.current?.(bounds)
  }, [])

  const onRenameLocation = useCallback(
    async (locationID, newName) => {
      try {
        const result = await window.api.setDeploymentLocationName(studyId, locationID, newName)

        if (result.error) {
          console.error('Error renaming location:', result.error)
          throw new Error(result.error)
        }

        // Optimistic update via queryClient (matches all periodCount variants).
        queryClient.setQueriesData(
          { queryKey: ['deploymentsActivity', studyId] },
          (prevActivity) => {
            if (!prevActivity) return prevActivity
            const updatedDeployments = prevActivity.deployments.map((deployment) => {
              if (deployment.locationID === locationID) {
                return { ...deployment, locationName: newName }
              }
              return deployment
            })
            return { ...prevActivity, deployments: updatedDeployments }
          }
        )

        queryClient.setQueryData(['deploymentsAll', studyId], (prev) => {
          if (!prev) return prev
          return prev.map((d) =>
            d.locationID === locationID ? { ...d, locationName: newName } : d
          )
        })

        // Invalidate related caches so other views update
        queryClient.invalidateQueries({ queryKey: ['deploymentLocations', studyId] })
        queryClient.invalidateQueries({ queryKey: ['deploymentsAll', studyId] })
        queryClient.invalidateQueries({ queryKey: ['heatmapData', studyId] })
      } catch (error) {
        console.error('Error renaming location:', error)
        throw error
      }
    },
    [studyId, queryClient]
  )

  // Detail-pane animation: keep the pane mounted for one fade-out cycle
  // after selection clears so the user sees a soft exit. paneSnapshot is
  // the deployment to render during that exit window.
  const [paneSnapshot, setPaneSnapshot] = useState(null)
  const [isPaneClosing, setIsPaneClosing] = useState(false)
  useEffect(() => {
    if (selectedLocation) {
      setPaneSnapshot(selectedLocation)
      setIsPaneClosing(false)
    } else if (paneSnapshot) {
      setIsPaneClosing(true)
      const timer = setTimeout(() => {
        setPaneSnapshot(null)
        setIsPaneClosing(false)
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [selectedLocation, paneSnapshot])

  // Esc closes the media pane. The map's own Esc handler (for exiting place
  // mode) runs alongside; we gate on !isPlaceMode so closing place mode
  // doesn't also clear the selection.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && selectedLocation && !isPlaceMode) {
        setSelectedLocation(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedLocation, isPlaceMode, setSelectedLocation])

  return (
    <div
      className={`flex flex-col px-4 h-full overflow-hidden ${isPlaceMode ? 'place-mode-active' : ''}`}
    >
      <PanelGroup direction="vertical" autoSaveId="deployments-v2">
        <Panel defaultSize={selectedLocation ? 38 : 100} minSize={20} className="flex flex-col">
          <PanelGroup direction="horizontal" autoSaveId="deployments-v3-top">
            <Panel defaultSize={62} minSize={20} className="flex flex-col">
              {isActivityLoading ? (
                <SkeletonDeploymentsList itemCount={6} />
              ) : activity ? (
                <LocationsList
                  studyId={studyId}
                  activity={activity}
                  selectedLocation={selectedLocation}
                  setSelectedLocation={setSelectedLocation}
                  onRenameLocation={onRenameLocation}
                  onSectionClick={handleSectionClick}
                  onPeriodCountChange={setPeriodCount}
                />
              ) : null}
            </Panel>
            <PanelResizeHandle className="w-1 mx-1.5 rounded-full bg-gray-100 hover:bg-gray-300 data-[resize-handle-state=drag]:bg-blue-300 cursor-col-resize transition-colors" />
            <Panel defaultSize={38} minSize={20} className="flex flex-col">
              {/* Cap the map at a comfortable max-height so on tall windows
                  it doesn't stretch to the full panel — the list timeline
                  can use the room productively, the map can't. */}
              <div className="max-h-[500px] h-full">
                {deploymentsList && (
                  <LocationMap
                    locations={deploymentsList}
                    selectedLocation={selectedLocation}
                    setSelectedLocation={setSelectedLocation}
                    onNewLatitude={onNewLatitude}
                    onNewLongitude={onNewLongitude}
                    isPlaceMode={isPlaceMode}
                    onPlaceLocation={handlePlaceLocation}
                    onExitPlaceMode={handleExitPlaceMode}
                    flyToRef={sectionFlyToRef}
                    studyId={studyId}
                  />
                )}
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
        {paneSnapshot && (
          <>
            <PanelResizeHandle className="h-1 my-3 rounded-full bg-gray-100 hover:bg-gray-300 data-[resize-handle-state=drag]:bg-blue-300 cursor-row-resize transition-colors" />
            <Panel defaultSize={62} minSize={20} className="flex flex-col">
              {/* No `key` on the wrapper so deployment-to-deployment swaps
                  don't re-trigger the enter animation. The inner pane uses
                  its own `key={deploymentID}` for state isolation. */}
              <div
                data-state={isPaneClosing ? 'closing' : 'open'}
                className="detail-pane-anim h-full flex flex-col min-h-0"
              >
                <DeploymentDetailPane
                  key={paneSnapshot.deploymentID}
                  studyId={studyId}
                  deployment={paneSnapshot}
                  onClose={() => setSelectedLocation(null)}
                  onRenameLocation={onRenameLocation}
                  onCommitLatLon={async (deploymentID, lat, lon) => {
                    await onNewLatitude(deploymentID, lat)
                    await onNewLongitude(deploymentID, lon)
                  }}
                  onEnterPlaceMode={handleEnterPlaceMode}
                />
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  )
}
