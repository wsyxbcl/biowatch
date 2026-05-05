import { useEffect, useState } from 'react'

const SPLIT_BREAKPOINT_PX = 900

function compute() {
  if (typeof window === 'undefined') return 'split'
  return window.innerWidth >= SPLIT_BREAKPOINT_PX ? 'split' : 'stacked'
}

export function useResponsiveLayout() {
  const [layout, setLayout] = useState(compute)

  useEffect(() => {
    const onResize = () => setLayout(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return layout
}
