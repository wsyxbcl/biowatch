import { useEffect, useState } from 'react'

const STORAGE_KEY_PREFIX = 'deploymentsSparkline:'

/**
 * Read+persist the sparkline rendering mode for a study. Mirrors the
 * existing mapLayer:${studyId} persistence pattern in deployments.jsx.
 *
 * @param {string} studyId
 * @returns {[string, (mode: string) => void]}
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

  // Re-read when studyId changes; always reset (don't keep prior study's value).
  useEffect(() => {
    if (!studyId) return
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}${studyId}`)
      setMode(saved || 'bars')
    } catch {
      setMode('bars')
    }
  }, [studyId])

  // Persist on every mode change (skips initial mount via the studyId guard
  // in localStorage write, which would just be a no-op on first render anyway).
  useEffect(() => {
    if (!studyId) return
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${studyId}`, mode)
    } catch {
      // localStorage may be disabled — in-memory state still works
    }
  }, [studyId, mode])

  return [mode, setMode]
}
