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

  const borderColor = region?.color || '#6b7280'
  const cardClass = [
    'bg-white rounded-lg p-3 mb-2 border border-gray-200 cursor-pointer transition-shadow',
    selected ? 'shadow-[0_0_0_2px_rgba(0,0,0,0.06)] border-gray-900' : ''
  ].join(' ')

  return (
    <div
      className={cardClass}
      style={{ borderLeft: `4px solid ${borderColor}` }}
      onClick={() => onSelect?.(model.reference.id)}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-gray-900">{model.name}</span>
          {region && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ color: region.badgeText, background: region.badgeBg }}
            >
              {region.label}
            </span>
          )}
        </div>
        <StatusPill state={isDownloading ? 'downloading' : isDownloaded ? 'downloaded' : 'idle'} />
      </div>

      <div className="text-xs text-gray-500 mb-1">
        v{model.reference.version} · {formatSize(model.size_in_MB)} ·{' '}
        <strong>{model.species_count} species</strong>
      </div>

      {!isDownloading && (
        <div className="text-xs text-gray-700 leading-snug">{model.description}</div>
      )}

      {isDownloading ? (
        <div className="mt-2">
          <div className="bg-indigo-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-500">
            <span>{downloadMessage}</span>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          {isDownloaded ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDelete()
              }}
              className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 bg-white hover:bg-red-50"
            >
              <Trash2 size={12} className="inline mr-1" />
              Delete
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDownload()
              }}
              className="text-xs px-2 py-1 rounded bg-gray-900 text-white hover:bg-gray-800"
            >
              <Download size={12} className="inline mr-1" />
              Download
            </button>
          )}
        </div>
      )}

      <div
        className="mt-2 text-xs text-indigo-700 cursor-pointer select-none"
        onClick={(e) => {
          e.stopPropagation()
          onToggleSpecies?.(model.reference.id)
        }}
      >
        {speciesOpen ? '▾' : '▸'} {speciesOpen ? 'Hide' : 'View'} {model.species_count} species
      </div>

      {speciesOpen && speciesPanel}
    </div>
  )
}

function StatusPill({ state }) {
  if (state === 'downloaded') {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
        ✓ Downloaded
      </span>
    )
  }
  if (state === 'downloading') {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800">
        Downloading…
      </span>
    )
  }
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700">
      Not downloaded
    </span>
  )
}
