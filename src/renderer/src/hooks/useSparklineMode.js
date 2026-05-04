import { useEffect, useState } from 'react'

const STORAGE_KEY_PREFIX = 'deploymentsSparkline:'

/**
 * Hook to read+write the sparkline mode for a study.
 */
export function useSparklineMode(studyId) {
  const [mode, setMode] = useState(() => {
    if (!studyId) return 'bars'
    try {
      return localStorage.getItem(`${STORAGE_KEY_PREFIX}${studyId}`) || 'bars'
    } catch {
      return 'bars'
    }
  })

  // If studyId changes (study switch), re-read.
  useEffect(() => {
    if (!studyId) return
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}${studyId}`)
      if (saved) setMode(saved)
    } catch {
      // ignore
    }
  }, [studyId])

  return [mode, setMode]
}
