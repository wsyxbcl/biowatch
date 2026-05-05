import { createContext, useContext, useEffect, useState } from 'react'
import { UndoManager } from './UndoManager.js'

const UndoContext = createContext(null)

export function UndoProvider({ children, studyId, getCurrentMediaId, navigateTo }) {
  const [manager] = useState(() => new UndoManager())

  // Keep manager callbacks in sync with the latest props. Reassigning these
  // fields is safe: the manager only invokes them later (on undo/redo), at
  // which point the closures see the current prop values.
  useEffect(() => {
    manager.getCurrentMediaId = () => getCurrentMediaId?.() ?? null
    manager.navigateTo = async (id) => {
      if (navigateTo) await navigateTo(id)
    }
  }, [manager, getCurrentMediaId, navigateTo])

  // Spec lock: stack scope is per study session. Wipe both stacks whenever
  // the active study changes — without this, a Cmd+Z after switching studies
  // would dispatch IPCs against the *previous* study's database (each
  // command's closure captures studyId at exec time).
  useEffect(() => {
    manager.clear()
  }, [manager, studyId])

  // Re-render consumers when stacks change so canUndo / canRedo stay accurate.
  const [, force] = useState(0)
  useEffect(() => manager.onChange(() => force((n) => n + 1)), [manager])

  return <UndoContext.Provider value={manager}>{children}</UndoContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUndo() {
  const manager = useContext(UndoContext)
  if (!manager) {
    throw new Error('useUndo must be used inside <UndoProvider>')
  }
  return manager
}
