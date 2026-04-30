import { useQuery } from '@tanstack/react-query'
import BestMediaCarousel from '../ui/BestMediaCarousel'

/**
 * Best captures band — section header + carousel. Hidden entirely when
 * there's nothing to show (no bboxes / favorites yet).
 *
 * The query here mirrors `BestMediaCarousel`'s — react-query dedupes by key,
 * so this is a free read once the carousel has cached data.
 */
export default function BestCapturesSection({ studyId, isRunning }) {
  const { data: bestMedia = [] } = useQuery({
    queryKey: ['bestMedia', studyId],
    queryFn: async () => {
      const response = await window.api.getBestMedia(studyId, { limit: 12 })
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    staleTime: Infinity,
    refetchInterval: isRunning ? 5000 : false
  })

  if (bestMedia.length === 0) return null

  return (
    <section>
      <h3 className="text-[0.7rem] uppercase tracking-wider text-gray-500 font-semibold mb-3">
        Best captures
      </h3>
      <BestMediaCarousel studyId={studyId} isRunning={isRunning} />
    </section>
  )
}
