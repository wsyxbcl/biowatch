import { memo } from 'react'

/**
 * Renders an activity sparkline for a deployment row. Three variants
 * sharing the same `periods` data:
 *   - 'bars'    → mini column chart (default)
 *   - 'line'    → smooth area chart (SVG)
 *   - 'heatmap' → colored cells, intensity = count
 *
 * `muted` swaps the primary color for slate-300, used on aggregated
 * section-header sparklines so children stand out.
 */
const Sparkline = memo(function Sparkline({
  periods,
  mode = 'bars',
  percentile90Count,
  muted = false
}) {
  if (!periods || periods.length === 0) return null
  const max = percentile90Count || 1

  if (mode === 'bars') {
    return (
      <div className="flex gap-px items-end h-[22px] w-full">
        {periods.map((period, i) => {
          const heightPct = period.count > 0 ? Math.min((period.count / max) * 100, 100) : 0
          return (
            <div
              key={i}
              title={`${period.count} observations`}
              className={`flex-1 ${muted ? 'bg-slate-300' : 'bg-[#77b7ff]'} rounded-sm`}
              style={{
                height: `${heightPct}%`,
                minHeight: period.count > 0 ? '2px' : '1px',
                opacity: period.count > 0 ? 1 : 0.3
              }}
            />
          )
        })}
      </div>
    )
  }

  if (mode === 'line') {
    const stroke = muted ? '#94a3b8' : '#3b82f6'
    const points = periods.map((p, i) => {
      const x = (i / (periods.length - 1 || 1)) * 100
      const y = 22 - Math.min(p.count / max, 1) * 20
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    const linePath = `M${points.join(' L')}`
    const areaPath = `${linePath} L100,22 L0,22 Z`
    return (
      <svg viewBox="0 0 100 22" preserveAspectRatio="none" className="w-full h-[22px] block">
        <path d={areaPath} fill={stroke} opacity="0.15" />
        <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" />
      </svg>
    )
  }

  if (mode === 'heatmap') {
    const palette = muted
      ? ['#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b']
      : ['#dbeafe', '#bfdbfe', '#60a5fa', '#3b82f6', '#1d4ed8']
    return (
      <div className="flex gap-px h-[14px] w-full items-stretch">
        {periods.map((period, i) => {
          const t = period.count > 0 ? period.count / max : 0
          const idx =
            period.count === 0 ? 0 : Math.min(palette.length - 1, Math.floor(t * palette.length))
          return (
            <div
              key={i}
              title={`${period.count} observations`}
              className="flex-1 rounded-sm"
              style={{ background: period.count > 0 ? palette[idx] : '#f9fafb' }}
            />
          )
        })}
      </div>
    )
  }

  return null
})

export default Sparkline
