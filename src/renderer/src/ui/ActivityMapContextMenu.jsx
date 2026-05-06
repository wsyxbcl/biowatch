import { useEffect } from 'react'
import { Download } from 'lucide-react'

export default function ActivityMapContextMenu({ x, y, onSave, onClose }) {
  useEffect(() => {
    const handleClickOutside = () => onClose()
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      className="fixed z-[2000] bg-white rounded-md shadow-lg border border-gray-200 py-1"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          onSave()
          onClose()
        }}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 w-full text-left"
      >
        <Download className="h-4 w-4" />
        Save map as PNG…
      </button>
    </div>
  )
}
