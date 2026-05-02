import { useEffect } from 'react'

/**
 * Translate vertical mouse-wheel input into horizontal scroll on the
 * referenced element. Native horizontal gestures (trackpad swipe, shift+wheel)
 * are left alone.
 */
export function useHorizontalWheelScroll(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref])
}
