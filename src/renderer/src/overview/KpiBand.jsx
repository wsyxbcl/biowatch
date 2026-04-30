import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as HoverCard from '@radix-ui/react-hover-card'
import { PawPrint, Camera, CalendarDays, Eye, Image as ImageIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import KpiTile from './KpiTile'
import SpanPicker from './SpanPicker'
import IucnBadge from '../ui/IucnBadge'
import SpeciesTooltipContent from '../ui/SpeciesTooltipContent'
import { useCommonName } from '../utils/commonNames'
import {
  formatStatNumber,
  formatCompactCount,
  formatSpan,
  formatRangeShort
} from './utils/formatStats'

/**
 * Render `children` in a fixed-position layer anchored just below
 * `triggerRef`'s bounding rect, portalled to document.body so the popover
 * escapes the surrounding Panel's `overflow: hidden` (react-resizable-panels
 * sets that on every Panel container).
 */
function PortalPopover({ open, triggerRef, children }) {
  const [pos, setPos] = useState(null)

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null)
      return
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setPos({ left: rect.left, top: rect.bottom + 8 })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, triggerRef])

  if (!open || !pos) return null
  return createPortal(
    <div className="fixed z-[1000]" style={{ left: pos.left, top: pos.top }}>
      {children}
    </div>,
    document.body
  )
}

const ICON_SIZE = 14

/**
 * KPI band for the Overview tab. Five tiles: Species, Cameras, Span, Observations, Media.
 * - Span tile is editable (DateTimePicker popover).
 * - Species tile is clickable when threatenedCount > 0 (threatened-list popover).
 *
 * @param {Object} props
 * @param {string} props.studyId
 * @param {Object} props.studyData - The full study `data` object (description, contributors, temporal, …).
 * @param {boolean} props.isImporting - Whether an import is in progress; controls polling.
 */
export default function KpiBand({ studyId, studyData, isImporting }) {
  const queryClient = useQueryClient()
  const [showPicker, setShowPicker] = useState(false)
  const [showThreatened, setShowThreatened] = useState(false)
  const spanTriggerRef = useRef(null)
  const speciesTriggerRef = useRef(null)

  const { data: stats } = useQuery({
    queryKey: ['overviewStats', studyId],
    queryFn: async () => {
      const response = await window.api.getOverviewStats(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    refetchInterval: isImporting ? 5000 : false,
    placeholderData: (prev) => prev
  })

  const speciesCount = stats?.speciesCount ?? null
  const threatenedCount = stats?.threatenedCount ?? null
  const threatenedSpecies = stats?.threatenedSpecies ?? []
  const cameraCount = stats?.cameraCount ?? null
  const locationCount = stats?.locationCount ?? null
  const observationCount = stats?.observationCount ?? null
  const cameraDays = stats?.cameraDays ?? null
  const mediaCount = stats?.mediaCount ?? null
  const rangeStart = stats?.derivedRange?.start ?? null
  const rangeEnd = stats?.derivedRange?.end ?? null

  const saveRange = async ({ start, end }) => {
    const newTemporal = { ...(studyData?.temporal || {}), start, end }
    await window.api.updateStudy(studyId, {
      data: { ...studyData, temporal: newTemporal }
    })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    queryClient.invalidateQueries({ queryKey: ['overviewStats', studyId] })
    setShowPicker(false)
  }

  const resetDatesToAuto = async () => {
    const newTemporal = { ...(studyData?.temporal || {}) }
    delete newTemporal.start
    delete newTemporal.end
    await window.api.updateStudy(studyId, {
      data: { ...studyData, temporal: newTemporal }
    })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    queryClient.invalidateQueries({ queryKey: ['overviewStats', studyId] })
    setShowPicker(false)
  }

  return (
    <div className="grid grid-cols-5 gap-2.5">
      <div className="flex" ref={speciesTriggerRef}>
        <KpiTile
          icon={<PawPrint size={ICON_SIZE} />}
          label="Species"
          value={formatStatNumber(speciesCount)}
          sub={threatenedCount > 0 ? 'threatened' : null}
          subAccent={threatenedCount > 0 ? formatStatNumber(threatenedCount) : null}
          onClick={threatenedCount > 0 ? () => setShowThreatened((v) => !v) : undefined}
        />
      </div>
      <PortalPopover
        open={showThreatened && threatenedSpecies.length > 0}
        triggerRef={speciesTriggerRef}
      >
        <ThreatenedSpeciesPopover
          studyId={studyId}
          species={threatenedSpecies}
          onClose={() => setShowThreatened(false)}
          ignoreOutsideClickRef={speciesTriggerRef}
        />
      </PortalPopover>

      <KpiTile
        icon={<Camera size={ICON_SIZE} />}
        label="Deployments"
        value={formatStatNumber(cameraCount)}
        sub={locationCount > 0 ? `across ${formatStatNumber(locationCount)} locations` : null}
      />

      <div className="flex" ref={spanTriggerRef}>
        <KpiTile
          icon={<CalendarDays size={ICON_SIZE} />}
          label="Span"
          value={formatSpan(rangeStart, rangeEnd)}
          sub={formatRangeShort(rangeStart, rangeEnd)}
          onEdit={() => setShowPicker((v) => !v)}
        />
      </div>
      <PortalPopover open={showPicker} triggerRef={spanTriggerRef}>
        <SpanPicker
          startValue={rangeStart}
          endValue={rangeEnd}
          onSave={saveRange}
          onCancel={() => setShowPicker(false)}
          onResetToAuto={resetDatesToAuto}
          ignoreOutsideClickRef={spanTriggerRef}
        />
      </PortalPopover>

      <KpiTile
        icon={<Eye size={ICON_SIZE} />}
        label="Observations"
        value={formatStatNumber(observationCount)}
        sub={cameraDays > 0 ? `from ${formatCompactCount(cameraDays)} camera-days` : null}
      />
      <KpiTile
        icon={<ImageIcon size={ICON_SIZE} />}
        label="Media"
        value={formatStatNumber(mediaCount)}
        sub={mediaCount > 0 ? 'photos & videos' : null}
      />
    </div>
  )
}

/**
 * Popover listing the threatened species detected in this study.
 * Each row links to the media tab filtered by that species.
 */
function ThreatenedSpeciesPopover({ studyId, species, onClose, ignoreOutsideClickRef }) {
  const navigate = useNavigate()
  const containerRef = useRef(null)

  useEffect(() => {
    const onMouseDown = (e) => {
      if (containerRef.current && containerRef.current.contains(e.target)) return
      if (ignoreOutsideClickRef?.current && ignoreOutsideClickRef.current.contains(e.target)) return
      onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, ignoreOutsideClickRef])

  const handleClick = (scientificName) => {
    navigate(`/study/${studyId}/media?species=${encodeURIComponent(scientificName)}`)
  }

  return (
    <div
      ref={containerRef}
      className="bg-white rounded-lg shadow-xl border border-gray-200 w-72 max-h-80 overflow-y-auto"
    >
      <div className="px-3 py-2 border-b border-gray-100 sticky top-0 bg-white">
        <div className="text-[0.7rem] uppercase tracking-wider text-gray-500 font-semibold">
          Threatened species
        </div>
      </div>
      <ul className="py-1">
        {species.map((s) => (
          <ThreatenedSpeciesRow
            key={s.scientificName}
            studyId={studyId}
            scientificName={s.scientificName}
            iucn={s.iucn}
            onClick={() => handleClick(s.scientificName)}
          />
        ))}
      </ul>
    </div>
  )
}

function ThreatenedSpeciesRow({ studyId, scientificName, iucn, onClick }) {
  const commonName = useCommonName(scientificName)
  const display = commonName && commonName !== scientificName ? commonName : scientificName
  const showScientific = commonName && commonName !== scientificName
  return (
    <li>
      <HoverCard.Root openDelay={200} closeDelay={120}>
        <HoverCard.Trigger asChild>
          <button
            type="button"
            onClick={onClick}
            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 transition-colors flex items-center gap-2"
          >
            <span className="flex-shrink-0">
              <IucnBadge category={iucn} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-sm capitalize text-gray-900">{display}</span>
              {showScientific && (
                <span className="text-xs italic text-gray-400 ml-1.5">{scientificName}</span>
              )}
            </span>
          </button>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            side="right"
            sideOffset={8}
            align="center"
            avoidCollisions={true}
            collisionPadding={16}
            className="z-[10001]"
          >
            <SpeciesTooltipContent imageData={{ scientificName }} studyId={studyId} size="lg" />
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>
    </li>
  )
}
