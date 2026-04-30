import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { CameraOff } from 'lucide-react'
import { useSequenceGap } from '../hooks/useSequenceGap'
import { useCommonName } from '../utils/commonNames'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'
import { isBlank, isHumanOrVehicle, isNonSpeciesLabel } from '../utils/speciesUtils'

const TOP_N = 8

/**
 * Fallback for the Best Captures band when there's no scored media yet.
 * Shows the most common detected species using their bundled Wikipedia
 * thumbnails. Hidden if no species have an `imageUrl` available.
 */
export default function CommonSpeciesFallback({ studyId }) {
  const navigate = useNavigate()
  const { sequenceGap } = useSequenceGap(studyId)

  const { data: speciesData } = useQuery({
    queryKey: ['sequenceAwareSpeciesDistribution', studyId, sequenceGap],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareSpeciesDistribution(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId && sequenceGap !== undefined,
    staleTime: Infinity
  })

  // Top species by count, excluding blanks/humans/processing labels, with a
  // resolvable Wikipedia image. Pre-sorted by count descending from the API.
  const candidates = (speciesData || [])
    .filter(
      (s) =>
        !isBlank(s.scientificName) &&
        !isHumanOrVehicle(s.scientificName) &&
        !isNonSpeciesLabel(s.scientificName)
    )
    .map((s) => ({
      ...s,
      info: resolveSpeciesInfo(s.scientificName)
    }))
    .filter((s) => s.info?.imageUrl)
    .slice(0, TOP_N)

  if (candidates.length === 0) return null

  const handleClick = (scientificName) => {
    navigate(`/study/${studyId}/media?species=${encodeURIComponent(scientificName)}`)
  }

  return (
    <section>
      <h3 className="text-[0.7rem] uppercase tracking-wider text-gray-500 font-semibold mb-3">
        Featured species
      </h3>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
        {candidates.map((c) => (
          <SpeciesReferenceCard key={c.scientificName} species={c} onClick={handleClick} />
        ))}
      </div>
    </section>
  )
}

function SpeciesReferenceCard({ species, onClick }) {
  const [imageError, setImageError] = useState(false)
  const commonName =
    useCommonName(species.scientificName) || species.scientificName || 'Unknown species'

  return (
    <button
      type="button"
      onClick={() => onClick(species.scientificName)}
      className="flex-shrink-0 w-40 rounded-lg overflow-hidden cursor-pointer border border-gray-200 shadow-sm hover:shadow-md transition-shadow text-left bg-white"
    >
      <div className="relative w-full h-28 bg-gray-100">
        {imageError ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300">
            <CameraOff size={24} />
          </div>
        ) : (
          <img
            src={species.info.imageUrl}
            alt={species.scientificName}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImageError(true)}
            referrerPolicy="no-referrer"
          />
        )}
      </div>
      <div className="px-2 py-1.5">
        <p className="text-xs font-medium text-gray-900 truncate capitalize">{commonName}</p>
        <p className="text-[0.65rem] text-gray-500">
          {species.count.toLocaleString('en-US')} observations
        </p>
      </div>
    </button>
  )
}
