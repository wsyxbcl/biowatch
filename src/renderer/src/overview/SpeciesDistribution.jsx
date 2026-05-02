import { useCallback, useEffect, useMemo, useState } from 'react'
import * as HoverCard from '@radix-ui/react-hover-card'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import SpeciesTooltipContent from '../ui/SpeciesTooltipContent'
import IucnBadge from '../ui/IucnBadge'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'
import { useCommonName } from '../utils/commonNames'
import { sortSpeciesHumansLast } from '../utils/speciesUtils'

/**
 * Single species row. Restyled for the full-width Overview placement.
 */
function SpeciesRow({
  species,
  storedCommonName,
  speciesImageMap,
  studyId,
  totalCount,
  onRowClick,
  scrollSignal
}) {
  const displayName =
    useCommonName(species.scientificName, { storedCommonName }) || species.scientificName
  const showScientific = species.scientificName && displayName !== species.scientificName
  const info = resolveSpeciesInfo(species.scientificName)
  const iucn = info?.iucn
  const studyImage = speciesImageMap[species.scientificName]
  const tooltipImageData =
    studyImage || (info?.imageUrl ? { scientificName: species.scientificName } : null)
  const [hoverOpen, setHoverOpen] = useState(false)

  useEffect(() => {
    if (scrollSignal > 0) setHoverOpen(false)
  }, [scrollSignal])

  return (
    <button
      type="button"
      className="cursor-pointer hover:bg-blue-50 transition-colors py-2.5 px-3 rounded flex items-center gap-3 w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
      onClick={() => onRowClick(species)}
      aria-label={`View ${displayName} in media tab`}
    >
      <HoverCard.Root
        key={species.scientificName}
        open={hoverOpen}
        onOpenChange={setHoverOpen}
        openDelay={200}
        closeDelay={120}
      >
        <HoverCard.Trigger asChild>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-80 flex-shrink-0">
              <span className="capitalize text-sm text-gray-900 font-medium">{displayName}</span>
              {showScientific && (
                <span className="text-gray-400 text-xs italic ml-2">{species.scientificName}</span>
              )}
            </div>
            <div className="w-8 flex-shrink-0">
              <IucnBadge category={iucn} />
            </div>
          </div>
        </HoverCard.Trigger>
        {tooltipImageData && (
          <HoverCard.Portal>
            <HoverCard.Content
              side="right"
              sideOffset={12}
              align="center"
              avoidCollisions={true}
              collisionPadding={16}
              className="z-[10000]"
            >
              <SpeciesTooltipContent imageData={tooltipImageData} studyId={studyId} size="lg" />
            </HoverCard.Content>
          </HoverCard.Portal>
        )}
      </HoverCard.Root>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="bg-blue-600 h-full rounded-full"
          style={{ width: `${(species.count / totalCount) * 100}%` }}
        />
      </div>
      <span className="w-14 text-right text-xs text-gray-500 tabular-nums flex-shrink-0">
        {species.count.toLocaleString('en-US')}
      </span>
    </button>
  )
}

/**
 * Full-width species distribution section. Pulls its own best-images.
 *
 * @param {Object} props
 * @param {string} props.studyId
 * @param {Array} props.speciesData - Sequence-aware species distribution.
 * @param {Array} props.taxonomicData - Taxonomic data from study metadata (for stored common names).
 */
export default function SpeciesDistribution({ studyId, speciesData, taxonomicData }) {
  const navigate = useNavigate()
  const [scrollSignal, setScrollSignal] = useState(0)
  const handleScroll = useCallback(() => setScrollSignal((s) => s + 1), [])

  const { data: bestImagesData } = useQuery({
    queryKey: ['bestImagesPerSpecies', studyId],
    queryFn: async () => {
      const response = await window.api.getBestImagePerSpecies(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    staleTime: 60000
  })

  const speciesImageMap = useMemo(() => {
    const map = {}
    if (bestImagesData) bestImagesData.forEach((item) => (map[item.scientificName] = item))
    return map
  }, [bestImagesData])

  const scientificToCommonMap = useMemo(() => {
    const map = {}
    if (taxonomicData && Array.isArray(taxonomicData)) {
      taxonomicData.forEach((taxon) => {
        if (taxon.scientificName && taxon?.vernacularNames?.eng) {
          map[taxon.scientificName] = taxon.vernacularNames.eng
        }
      })
    }
    return map
  }, [taxonomicData])

  const totalCount = useMemo(
    () => (speciesData || []).reduce((sum, item) => sum + item.count, 0),
    [speciesData]
  )

  // Memoize the sort — without it, every scrollSignal bump (one per scroll
  // event) would re-sort the array before the rows compare equal.
  const sortedSpecies = useMemo(
    () => (speciesData ? sortSpeciesHumansLast(speciesData) : []),
    [speciesData]
  )

  const handleRowClick = (species) => {
    navigate(`/study/${studyId}/media?species=${encodeURIComponent(species.scientificName)}`)
  }

  return (
    <section className="flex flex-col min-h-0">
      <h3 className="text-[0.7rem] uppercase tracking-wider text-gray-500 font-semibold mb-3">
        Species distribution
      </h3>

      {speciesData === undefined ? (
        <SpeciesListSkeleton />
      ) : speciesData.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg px-4 py-8 text-center">
          <p className="text-sm font-medium text-gray-600">No species detected yet</p>
          <p className="text-xs text-gray-500 mt-1">
            Run a classification model to see what&apos;s been captured.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-y-auto overflow-x-hidden pr-3" onScroll={handleScroll}>
            {sortedSpecies.map((species) => {
              const storedCommonName = scientificToCommonMap[species.scientificName] || null
              return (
                <SpeciesRow
                  key={species.scientificName}
                  species={species}
                  storedCommonName={storedCommonName}
                  speciesImageMap={speciesImageMap}
                  studyId={studyId}
                  totalCount={totalCount}
                  onRowClick={handleRowClick}
                  scrollSignal={scrollSignal}
                />
              )
            })}
          </div>
          <IucnLegend />
        </>
      )}
    </section>
  )
}

function IucnLegend() {
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 text-[0.7rem] text-gray-500 flex items-start gap-x-4">
      <span className="flex-shrink-0 leading-5">IUCN status:</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <LegendItem code="NE" label="Not Evaluated" />
        <LegendItem code="LC" label="Least Concern" />
        <LegendItem code="NT" label="Near Threatened" />
        <LegendItem code="VU" label="Vulnerable" />
        <LegendItem code="EN" label="Endangered" />
        <LegendItem code="CR" label="Critically Endangered" />
      </div>
    </div>
  )
}

function LegendItem({ code, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <IucnBadge category={code} />
      {label}
    </span>
  )
}

/**
 * Pulsing placeholder rows shown while the species query is loading. Same
 * row layout as the real list so the section doesn't reflow on data arrival.
 */
function SpeciesListSkeleton() {
  // Stable widths per row (no Math.random per render — would visibly twitch).
  const widths = [85, 70, 55, 35, 22]
  return (
    <div className="flex flex-col">
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5 px-3">
          <div className="w-80 flex-shrink-0 flex items-center gap-3">
            <div className="h-3 w-32 bg-gray-200 rounded animate-pulse" />
            <div className="h-3 w-20 bg-gray-100 rounded animate-pulse" />
          </div>
          <div className="w-8 flex-shrink-0">
            <div className="h-4 w-7 bg-gray-100 rounded animate-pulse" />
          </div>
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gray-200 rounded-full animate-pulse"
              style={{ width: `${w}%` }}
            />
          </div>
          <div className="w-14 flex-shrink-0 flex justify-end">
            <div className="h-3 w-10 bg-gray-100 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}
