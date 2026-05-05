import { useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import ModelCard from './ModelCard'
import SpeciesPanel from './SpeciesPanel'
import CustomModelCard from './CustomModelCard'

function orderModels(modelZoo) {
  const worldwide = modelZoo.filter((m) => m.region === 'worldwide')
  const regional = modelZoo
    .filter((m) => m.region !== 'worldwide')
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...worldwide, ...regional]
}

export default function ModelListPane({
  modelZoo,
  selectedId,
  openSpeciesId,
  onSelect,
  onToggleSpecies,
  refreshKey,
  downloadedCount,
  onDownloadStatusChange,
  onClearAll
}) {
  const ordered = useMemo(() => orderModels(modelZoo), [modelZoo])

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-3 min-w-0 h-full">
      <div className="flex justify-between items-center mb-2 px-1">
        <span className="text-xs font-semibold text-gray-900">
          {modelZoo.length} models · {downloadedCount} downloaded
        </span>
        {downloadedCount > 0 && (
          <button
            onClick={onClearAll}
            className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
          >
            <Trash2 size={12} />
            Clear all
          </button>
        )}
      </div>

      {ordered.map((model) => (
        <ModelCard
          key={model.reference.id}
          model={model}
          selected={selectedId === model.reference.id}
          speciesOpen={openSpeciesId === model.reference.id}
          onSelect={onSelect}
          onToggleSpecies={onToggleSpecies}
          speciesPanel={<SpeciesPanel model={model} />}
          refreshKey={refreshKey}
          onDownloadStatusChange={onDownloadStatusChange}
        />
      ))}

      <CustomModelCard />
    </div>
  )
}
