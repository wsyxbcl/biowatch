import { useState, useEffect, useCallback } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { findPythonEnvironment } from '../../../shared/mlmodels'
import {
  isOwnEnvironmentDownload,
  isDownloadComplete,
  determineInitialDownloadState,
  calculateProgressInfo
} from '../../../shared/downloadState'
import { getRegion } from './regions'

function formatSize(mb) {
  const rounded = Math.round(mb / 50) * 50
  return rounded > 1000 ? `${(rounded / 1000).toFixed(2)} GB` : `${rounded} MB`
}

export default function ModelCard({
  model,
  selected,
  speciesOpen,
  onSelect,
  onToggleSpecies,
  speciesPanel,
  refreshKey = 0,
  onDownloadStatusChange
}) {
  const region = getRegion(model.region)
  const pythonEnvironment = findPythonEnvironment(model.pythonEnvironment)

  const [status, setStatus] = useState({ model: {}, pythonEnvironment: {} })
  const [isDownloaded, setIsDownloaded] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  // Initial fetch + react to refreshKey (clear-all)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await window.api.getMLModelDownloadStatus({
        modelReference: model.reference,
        pythonEnvironmentReference: pythonEnvironment.reference
      })
      if (cancelled) return
      const init = determineInitialDownloadState({
        modelStatus: s.model,
        envStatus: s.pythonEnvironment,
        currentModelId: model.reference.id
      })
      setIsDownloaded(init.isDownloaded)
      setIsDownloading(init.isDownloading)
      setStatus(s)
    })()
    return () => {
      cancelled = true
    }
  }, [model.reference, pythonEnvironment.reference, refreshKey])

  // Polling while downloading
  useEffect(() => {
    if (!isDownloading) return undefined
    const id = setInterval(async () => {
      const s = await window.api.getMLModelDownloadStatus({
        modelReference: model.reference,
        pythonEnvironmentReference: pythonEnvironment.reference
      })
      setStatus(s)
      const envActiveModelId = s.pythonEnvironment?.opts?.activeDownloadModelId
      const isOwnEnvDl = isOwnEnvironmentDownload(envActiveModelId, model.reference.id)
      if (
        isDownloadComplete({
          modelState: s.model.state,
          envState: s.pythonEnvironment.state,
          isOwnEnvDownload: isOwnEnvDl
        })
      ) {
        setIsDownloaded(true)
        setIsDownloading(false)
      }
    }, 500)
    return () => clearInterval(id)
  }, [isDownloading, model.reference, pythonEnvironment.reference])

  // Notify parent when downloaded flips
  useEffect(() => {
    onDownloadStatusChange?.(model.reference.id, isDownloaded)
  }, [isDownloaded, model.reference.id, onDownloadStatusChange])

  const handleDownload = useCallback(async () => {
    setIsDownloading(true)
    try {
      await window.api.downloadMLModel(model.reference)
      await window.api.downloadPythonEnvironment({
        ...pythonEnvironment.reference,
        requestingModelId: model.reference.id
      })
      const s = await window.api.getMLModelDownloadStatus({
        modelReference: model.reference,
        pythonEnvironmentReference: pythonEnvironment.reference
      })
      setStatus(s)
      setIsDownloaded(true)
      setIsDownloading(false)
      toast.success(`${model.name} downloaded`, {
        description: 'The model is ready to use.',
        duration: 5000
      })
    } catch (err) {
      console.error('Download failed', err)
      setIsDownloading(false)
    }
  }, [model.reference, model.name, pythonEnvironment.reference])

  const handleDelete = useCallback(async () => {
    try {
      await window.api.deleteLocalMLModel(model.reference)
      setIsDownloaded(false)
    } catch (err) {
      console.error('Delete failed', err)
    }
  }, [model.reference])

  const { downloadMessage, downloadProgress } = calculateProgressInfo({
    modelStatus: status.model,
    envStatus: status.pythonEnvironment,
    currentModelId: model.reference.id
  })

  const cardClass = [
    'bg-white rounded-lg p-4 mb-2 border cursor-pointer transition-shadow',
    selected
      ? 'border-blue-300 shadow-[0_0_0_2px_rgba(59,130,246,0.15)]'
      : 'border-gray-200 hover:shadow-md'
  ].join(' ')

  return (
    <div className={cardClass} onClick={() => onSelect?.(model.reference.id)}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-sm text-gray-900 truncate">{model.name}</span>
          {region && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 inline-flex items-center gap-1 flex-shrink-0">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: region.color }}
                aria-hidden
              />
              {region.label}
            </span>
          )}
        </div>
        <div className="flex-shrink-0">
          {isDownloading ? (
            <StatusPill state="downloading" />
          ) : isDownloaded ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDelete()
              }}
              className="text-xs px-3 py-1 rounded-md border border-gray-200 bg-white text-red-600 hover:bg-red-50 hover:border-red-200 inline-flex items-center gap-1.5 shadow-xs"
            >
              <Trash2 size={12} />
              Delete
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDownload()
              }}
              className="text-xs px-3 py-1 rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5 shadow-xs"
            >
              <Download size={12} />
              Download
            </button>
          )}
        </div>
      </div>

      <div className="text-xs text-gray-500 mb-1.5">
        v{model.reference.version} · {formatSize(model.size_in_MB)} ·{' '}
        <span className="text-gray-700 font-medium">{model.species_count} species</span>
      </div>

      {!isDownloading && (
        <div className="text-xs text-gray-600 leading-snug">{model.description}</div>
      )}

      {isDownloading && (
        <div className="mt-3">
          <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-500">
            <span>{downloadMessage}</span>
          </div>
        </div>
      )}

      <div
        className="mt-3 text-xs text-blue-600 hover:underline cursor-pointer select-none"
        onClick={(e) => {
          e.stopPropagation()
          onToggleSpecies?.(model.reference.id)
        }}
      >
        {speciesOpen ? '▾ Hide species' : `▸ View ${model.species_count} species`}
      </div>

      {speciesOpen && speciesPanel}
    </div>
  )
}

function StatusPill({ state }) {
  if (state === 'downloaded') {
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
        ✓ Downloaded
      </span>
    )
  }
  if (state === 'downloading') {
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
        Downloading…
      </span>
    )
  }
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
      Not downloaded
    </span>
  )
}
