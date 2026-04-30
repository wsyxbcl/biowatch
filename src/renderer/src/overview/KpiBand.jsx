import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PawPrint, Camera, CalendarDays, Eye, Image as ImageIcon } from 'lucide-react'
import KpiTile from './KpiTile'
import DateTimePicker from '../ui/DateTimePicker'
import { formatStatNumber, formatSpan, formatRangeShort } from './utils/formatStats'

const ICON_SIZE = 14

/**
 * KPI band for the Overview tab. Five tiles: Species, Cameras, Span, Observations, Media.
 * The Span tile is editable; clicking opens the DateTimePicker popover.
 *
 * @param {Object} props
 * @param {string} props.studyId
 * @param {Object} props.studyData - The full study `data` object (description, contributors, temporal, …).
 * @param {boolean} props.isImporting - Whether an import is in progress; controls polling.
 */
export default function KpiBand({ studyId, studyData, isImporting }) {
  const queryClient = useQueryClient()
  const [showStartPicker, setShowStartPicker] = useState(false)

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
  const cameraCount = stats?.cameraCount ?? null
  const locationCount = stats?.locationCount ?? null
  const observationCount = stats?.observationCount ?? null
  const cameraDays = stats?.cameraDays ?? null
  const mediaCount = stats?.mediaCount ?? null
  const rangeStart = stats?.derivedRange?.start ?? null
  const rangeEnd = stats?.derivedRange?.end ?? null

  const saveDate = async (which, isoTimestamp) => {
    const dateOnly = isoTimestamp.split('T')[0]
    const newTemporal = { ...(studyData?.temporal || {}) }
    newTemporal[which] = dateOnly
    await window.api.updateStudy(studyId, {
      data: { ...studyData, temporal: newTemporal }
    })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    queryClient.invalidateQueries({ queryKey: ['overviewStats', studyId] })
    setShowStartPicker(false)
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
    setShowStartPicker(false)
  }

  return (
    <div className="grid grid-cols-5 gap-2.5">
      <KpiTile
        icon={<PawPrint size={ICON_SIZE} />}
        label="Species"
        value={formatStatNumber(speciesCount)}
        sub={threatenedCount > 0 ? 'threatened' : null}
        subAccent={threatenedCount > 0 ? formatStatNumber(threatenedCount) : null}
      />
      <KpiTile
        icon={<Camera size={ICON_SIZE} />}
        label="Cameras"
        value={formatStatNumber(cameraCount)}
        sub={locationCount > 0 ? `across ${formatStatNumber(locationCount)} locations` : null}
      />

      <div className="relative">
        <KpiTile
          icon={<CalendarDays size={ICON_SIZE} />}
          label="Span"
          value={formatSpan(rangeStart, rangeEnd)}
          sub={formatRangeShort(rangeStart, rangeEnd)}
          onEdit={() => setShowStartPicker(true)}
        />
        {showStartPicker && (
          <div className="absolute left-0 top-full mt-2 z-50">
            <DateTimePicker
              value={rangeStart ? `${rangeStart}T00:00:00` : new Date().toISOString()}
              onChange={(iso) => saveDate('start', iso)}
              onCancel={() => setShowStartPicker(false)}
              onResetToAuto={resetDatesToAuto}
              dateOnly
            />
          </div>
        )}
      </div>

      <KpiTile
        icon={<Eye size={ICON_SIZE} />}
        label="Observations"
        value={formatStatNumber(observationCount)}
        sub={cameraDays > 0 ? `from ${formatStatNumber(cameraDays)} camera-days` : null}
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
