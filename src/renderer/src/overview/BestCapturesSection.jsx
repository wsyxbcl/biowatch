import { Camera as CameraIcon } from 'lucide-react'
import BestMediaCarousel from '../ui/BestMediaCarousel'

/**
 * Best captures band — section header + carousel + polite empty state.
 * Renders even when the carousel has no items.
 */
export default function BestCapturesSection({ studyId, isRunning }) {
  return (
    <section>
      <h3 className="text-[0.7rem] uppercase tracking-wider text-gray-500 font-semibold mb-3">
        Best captures
      </h3>
      <BestMediaCarousel
        studyId={studyId}
        isRunning={isRunning}
        renderEmpty={() => (
          <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg px-4 py-6 text-sm text-gray-500 flex items-center justify-center gap-2">
            <CameraIcon size={16} className="text-gray-400" />
            Top captures will appear here after classification
          </div>
        )}
      />
    </section>
  )
}
