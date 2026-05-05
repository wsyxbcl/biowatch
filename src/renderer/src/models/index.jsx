import { useState, useCallback } from 'react'
import MapPane from './MapPane'
import ModelListPane from './ModelListPane'
import { useResponsiveLayout } from './useResponsiveLayout'

export default function MlZoo({ modelZoo }) {
  const layout = useResponsiveLayout()
  const [selectedId, setSelectedId] = useState(
    () => modelZoo.find((m) => m.region === 'worldwide')?.reference.id ?? null
  )
  const [openSpeciesId, setOpenSpeciesId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [downloadedSet, setDownloadedSet] = useState(new Set())

  const handleSelect = useCallback((id) => setSelectedId(id), [])
  const handleToggleSpecies = useCallback(
    (id) => setOpenSpeciesId((cur) => (cur === id ? null : id)),
    []
  )
  const handleDownloadStatusChange = useCallback((modelId, isDownloaded) => {
    setDownloadedSet((prev) => {
      const next = new Set(prev)
      if (isDownloaded) next.add(modelId)
      else next.delete(modelId)
      return next
    })
  }, [])
  const handleClearAll = useCallback(async () => {
    try {
      const result = await window.api.clearAllLocalMLModel()
      if (result?.success) setRefreshKey((k) => k + 1)
    } catch (err) {
      console.error('Clear all failed', err)
    }
  }, [])

  if (layout === 'split') {
    return (
      <div className="flex flex-row h-full max-w-7xl mx-auto w-full">
        <div className="min-w-0" style={{ flexBasis: '55%', flexGrow: 1 }}>
          <MapPane
            modelZoo={modelZoo}
            selectedId={selectedId}
            onSelect={handleSelect}
            layout={layout}
          />
        </div>
        <div className="min-w-0" style={{ flexBasis: '45%', flexGrow: 1 }}>
          <ModelListPane
            modelZoo={modelZoo}
            selectedId={selectedId}
            openSpeciesId={openSpeciesId}
            onSelect={handleSelect}
            onToggleSpecies={handleToggleSpecies}
            refreshKey={refreshKey}
            downloadedCount={downloadedSet.size}
            onDownloadStatusChange={handleDownloadStatusChange}
            onClearAll={handleClearAll}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <MapPane
        modelZoo={modelZoo}
        selectedId={selectedId}
        onSelect={handleSelect}
        layout={layout}
      />
      <div className="flex-1 min-h-0">
        <ModelListPane
          modelZoo={modelZoo}
          selectedId={selectedId}
          openSpeciesId={openSpeciesId}
          onSelect={handleSelect}
          onToggleSpecies={handleToggleSpecies}
          refreshKey={refreshKey}
          downloadedCount={downloadedSet.size}
          onDownloadStatusChange={handleDownloadStatusChange}
          onClearAll={handleClearAll}
        />
      </div>
    </div>
  )
}
