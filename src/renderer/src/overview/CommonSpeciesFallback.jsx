import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import * as HoverCard from '@radix-ui/react-hover-card'
import { CameraOff, ChevronLeft, ChevronRight } from 'lucide-react'
import { useSequenceGap } from '../hooks/useSequenceGap'
import { useCommonName } from '../utils/commonNames'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'
import { isBlank, isHumanOrVehicle, isNonSpeciesLabel } from '../utils/speciesUtils'
import SpeciesTooltipContent from '../ui/SpeciesTooltipContent'

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
      <ScrollableStrip>
        {candidates.map((c) => (
          <SpeciesReferenceCard
            key={c.scientificName}
            species={c}
            studyId={studyId}
            onClick={handleClick}
          />
        ))}
      </ScrollableStrip>
    </section>
  )
}

/**
 * Horizontal strip with chevron scroll buttons + fades.
 * Matches the BestMediaCarousel pattern.
 */
function ScrollableStrip({ children }) {
  const containerRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const checkScroll = () => {
      setCanScrollLeft(container.scrollLeft > 0)
      setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 5)
    }

    container.addEventListener('scroll', checkScroll)
    checkScroll()
    window.addEventListener('resize', checkScroll)

    return () => {
      container.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [children])

  const scroll = (direction) => {
    const container = containerRef.current
    if (!container) return
    container.scrollBy({
      left: direction === 'left' ? -container.clientWidth * 0.75 : container.clientWidth * 0.75,
      behavior: 'smooth'
    })
  }

  return (
    <div className="relative">
      {canScrollLeft && (
        <button
          type="button"
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 rounded-full p-1 shadow-md border border-gray-200"
          onClick={() => scroll('left')}
          aria-label="Scroll left"
        >
          <ChevronLeft size={20} />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 rounded-full p-1 shadow-md border border-gray-200"
          onClick={() => scroll('right')}
          aria-label="Scroll right"
        >
          <ChevronRight size={20} />
        </button>
      )}
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-white to-transparent z-[1] pointer-events-none" />
      )}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white to-transparent z-[1] pointer-events-none" />
      )}
      <div
        ref={containerRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide py-3"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {children}
      </div>
    </div>
  )
}

function SpeciesReferenceCard({ species, studyId, onClick }) {
  const [imageError, setImageError] = useState(false)
  const commonName =
    useCommonName(species.scientificName) || species.scientificName || 'Unknown species'

  return (
    <HoverCard.Root openDelay={200} closeDelay={120}>
      <HoverCard.Trigger asChild>
        <button
          type="button"
          onClick={() => onClick(species.scientificName)}
          className="flex-shrink-0 w-48 rounded-lg overflow-hidden cursor-pointer border border-gray-200 shadow hover:shadow-md transition-shadow text-left bg-white"
        >
          <div className="relative w-full h-36 bg-gray-100">
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
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          sideOffset={8}
          align="center"
          avoidCollisions={true}
          collisionPadding={16}
          className="z-[10000]"
        >
          <SpeciesTooltipContent
            imageData={{ scientificName: species.scientificName }}
            studyId={studyId}
            size="lg"
          />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}
