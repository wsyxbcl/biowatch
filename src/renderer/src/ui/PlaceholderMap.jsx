import { MapPin } from 'lucide-react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { Link } from 'react-router'
import HideLeafletAttribution from './HideLeafletAttribution'

/**
 * PlaceholderMap - Shows a world map with an overlay message when deployment coordinates are missing.
 *
 * @param {string} title - Main heading text for the overlay
 * @param {string} description - Explanatory text
 * @param {string} linkTo - Optional route path for action button (relative to study)
 * @param {string} linkText - Optional button text
 * @param {string} studyId - Study ID for constructing navigation links
 * @param {Component} icon - Lucide icon component (default: MapPin)
 */
function PlaceholderMap({ title, description, linkTo, linkText, studyId, icon: Icon = MapPin }) {
  return (
    <div className="w-full h-full bg-white rounded-xl border border-gray-200 shadow-md overflow-hidden relative">
      <MapContainer
        center={[5, 20]}
        zoom={3}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
        scrollWheelZoom={true}
      >
        <HideLeafletAttribution />
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com">Esri</a>'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
      </MapContainer>

      {/* Compact overlay card — leaves the map visible around it */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1000] p-3">
        <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg px-4 py-3 max-w-[18rem] text-center pointer-events-auto">
          <div className="flex justify-center mb-2">
            <div className="p-2 bg-blue-100 rounded-full">
              <Icon className="text-blue-600" size={20} />
            </div>
          </div>
          <h3 className="text-sm font-medium text-gray-900 mb-1">{title}</h3>
          <p className="text-xs text-gray-600 mb-3 leading-snug">{description}</p>
          {linkTo && linkText && studyId && (
            <Link
              to={`/study/${studyId}${linkTo}`}
              className="inline-flex items-center px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors"
            >
              {linkText}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

export default PlaceholderMap
