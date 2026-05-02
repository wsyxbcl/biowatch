import { Filter, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import DeploymentMediaGallery from '../media/DeploymentMediaGallery'
import EditableLocationName from './EditableLocationName'

/**
 * Bottom-pane container for the Deployments tab. Mounted only when a
 * deployment is selected. Header shows the inline-editable deployment
 * name, a species-filter popover, and a close button. Body for V1
 * contains DeploymentMediaGallery; later additions (timeline graph,
 * camera-days, species at location) slot in as siblings inside the
 * body.
 */
export default function DeploymentDetailPane({
  studyId,
  deployment,
  onClose,
  onRenameLocation
}) {
  const [selectedSpecies, setSelectedSpecies] = useState([])
  // Reset filter when switching deployments — a different deployment may
  // not have the previously-picked species at all.
  useEffect(() => {
    setSelectedSpecies([])
  }, [deployment.deploymentID])

  return (
    <div className="flex flex-col h-full bg-white min-h-0">
      <div className="flex items-center justify-between px-2 py-2 border-b border-gray-200 flex-shrink-0 gap-2">
        {/* isSelected=false keeps the header in the same neutral gray as
            the rest of the pane chrome — the blue "selected" treatment is
            for the list rows where it's a state indicator. */}
        <EditableLocationName
          locationID={deployment.locationID || deployment.deploymentID}
          locationName={deployment.locationName}
          isSelected={false}
          onRename={onRenameLocation}
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          <SpeciesFilterButton
            studyId={studyId}
            deploymentID={deployment.deploymentID}
            selectedSpecies={selectedSpecies}
            onChange={setSelectedSpecies}
          />
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
            title="Close (Esc)"
            aria-label="Close media pane"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <DeploymentMediaGallery
          deploymentID={deployment.deploymentID}
          species={selectedSpecies}
        />
      </div>
    </div>
  )
}

/**
 * Filter icon + popover with species pills. Pulls the species distribution
 * scoped to the current deployment; selection toggles pills, which thread
 * back into the gallery's species filter.
 */
function SpeciesFilterButton({ studyId, deploymentID, selectedSpecies, onChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const popoverRef = useRef(null)
  const buttonRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const onDown = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target)
      ) {
        setIsOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [isOpen])

  // Species seen at this deployment, with media counts. Lazy-loaded on
  // first popover open; cached per (studyId, deploymentID).
  const { data: speciesList = [] } = useQuery({
    queryKey: ['deploymentSpecies', studyId, deploymentID],
    queryFn: async () => {
      const response = await window.api.getDeploymentSpecies(studyId, deploymentID)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: isOpen && !!studyId && !!deploymentID,
    staleTime: Infinity
  })

  const toggle = (name) => {
    onChange(
      selectedSpecies.includes(name)
        ? selectedSpecies.filter((s) => s !== name)
        : [...selectedSpecies, name]
    )
  }

  const clearAll = () => onChange([])

  const hasFilter = selectedSpecies.length > 0

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((v) => !v)}
        className={`p-1 rounded relative ${
          hasFilter
            ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        }`}
        title={hasFilter ? `Filter: ${selectedSpecies.length} species` : 'Filter species'}
        aria-label="Filter species"
      >
        <Filter size={16} />
        {hasFilter && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-blue-500" />
        )}
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1 w-72 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-[1100] p-2"
        >
          <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-gray-100">
            <span className="text-xs font-medium text-gray-700">Filter by species</span>
            {hasFilter && (
              <button
                onClick={clearAll}
                className="text-xs text-blue-600 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          {speciesList.length === 0 ? (
            <div className="px-2 py-3 text-xs text-gray-400">Loading…</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {speciesList.map((s) => {
                const isSelected = selectedSpecies.includes(s.scientificName)
                return (
                  <button
                    key={s.scientificName}
                    onClick={() => toggle(s.scientificName)}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                      isSelected
                        ? 'bg-blue-500 border-blue-500 text-white hover:bg-blue-600'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                    title={`${s.scientificName} (${s.count})`}
                  >
                    {s.scientificName}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
