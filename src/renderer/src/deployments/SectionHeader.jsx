import { memo, useCallback } from 'react'
import EditableLocationName from './EditableLocationName'
import Sparkline from './Sparkline'

/**
 * Always-expanded section header for co-located deployments. Clicking
 * the header flies the map to the bounds of the group's children — it
 * does NOT change the current deployment selection (the detail pane
 * stays put if open).
 */
const SectionHeader = memo(function SectionHeader({
  group,
  sparklineMode,
  percentile90Count,
  isSelected,
  onRenameLocation,
  onSectionClick,
  hasTimestamps = true
}) {
  const handleClick = useCallback(() => {
    onSectionClick(group)
  }, [group, onSectionClick])

  // In the no-timestamps path the aggregated periods are empty, so fall back
  // to summing each child's totalCount.
  const total = hasTimestamps
    ? group.aggregatedPeriods.reduce((sum, p) => sum + (p.count || 0), 0)
    : group.deployments.reduce((sum, d) => sum + (d.totalCount || 0), 0)

  return (
    <div
      onClick={handleClick}
      className={`flex gap-3 items-center px-3 h-9 bg-gray-100 hover:bg-gray-200 cursor-pointer border-b border-gray-200 transition-colors ${
        isSelected ? 'border-l-4 border-l-blue-500 pl-2' : 'border-l-4 border-l-transparent'
      }`}
    >
      <div className="flex items-center gap-2 w-[140px] min-w-0">
        <div className="min-w-0 flex-1">
          <EditableLocationName
            locationID={group.locationID}
            locationName={group.locationName}
            isSelected={isSelected}
            onRename={onRenameLocation}
          />
        </div>
        <span className="text-xs text-gray-600 bg-gray-300 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
          {group.deployments.length}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        {hasTimestamps && (
          <Sparkline
            periods={group.aggregatedPeriods}
            mode={sparklineMode}
            percentile90Count={percentile90Count}
            muted
          />
        )}
      </div>

      <div className="flex-shrink-0 w-16 text-right text-xs text-gray-600 tabular-nums">
        {total.toLocaleString()}
      </div>
    </div>
  )
})

export default SectionHeader
