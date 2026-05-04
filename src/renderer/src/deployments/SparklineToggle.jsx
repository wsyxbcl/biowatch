import { BarChart3, LineChart, Grid3x3 } from 'lucide-react'
import { useCallback } from 'react'

const STORAGE_KEY_PREFIX = 'deploymentsSparkline:'

const MODES = [
  { id: 'bars', label: 'Bars', Icon: BarChart3 },
  { id: 'line', label: 'Line', Icon: LineChart },
  { id: 'heatmap', label: 'Heatmap', Icon: Grid3x3 }
]

/**
 * Three icon buttons that cycle the sparkline rendering mode for the
 * current study. Persisted in localStorage so the user's preference
 * survives navigation, mirroring the existing `mapLayer:${studyId}`
 * persistence pattern in deployments.jsx.
 */
export default function SparklineToggle({ studyId, mode, onChange }) {
  const handleClick = useCallback(
    (id) => {
      onChange(id)
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${studyId}`, id)
      } catch {
        // localStorage may be disabled — fall through, in-memory state still works
      }
    },
    [studyId, onChange]
  )

  return (
    <div className="flex items-center gap-px rounded border border-gray-200 bg-white p-px">
      {MODES.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => handleClick(id)}
          title={label}
          aria-label={`Sparkline: ${label}`}
          aria-pressed={mode === id}
          className={`p-1 rounded ${
            mode === id
              ? 'bg-blue-50 text-blue-700'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}
