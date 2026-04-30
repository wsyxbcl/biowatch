import { forwardRef } from 'react'
import { computeBboxLabelPosition } from '../utils/positioning'
import { resolveCommonName } from '../../../shared/commonNames/index.js'

/**
 * Species-only label pill anchored above a bbox on the image.
 * Click selects the matching observation in the rail.
 *
 * Color encodes validation:
 *   - Selected: filled near-black
 *   - Validated (human): filled #2563eb
 *   - Predicted (model): filled #60a5fa
 */
const BboxLabelMinimal = forwardRef(function BboxLabelMinimal(
  { bbox, isSelected, isValidated, onClick },
  ref
) {
  // Match the fallback chain in ObservationRow: prefer the dictionary's
  // curated common name (so LILA's "yellow_baboon" renders as "yellow baboon"
  // even when the raw DB row keeps the snake_case category in commonName),
  // then fall back to the DB value, then to the scientific name. "Blank" only
  // for confirmed-blank observationType; bbox without classification reads as
  // "—".
  const dictCommon = resolveCommonName(bbox.scientificName)
  const displayName =
    dictCommon ||
    bbox.commonName ||
    bbox.scientificName ||
    (bbox.observationType === 'blank' ? 'Blank' : '—')
  const { left: leftPos, top: topPos, transform: transformVal } = computeBboxLabelPosition(bbox)

  const bg = isSelected ? 'bg-[#030213]' : isValidated ? 'bg-[#2563eb]' : 'bg-[#60a5fa]'

  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`absolute pointer-events-auto h-5 px-2 text-white text-xs font-medium whitespace-nowrap max-w-full truncate flex items-center capitalize transition-colors hover:brightness-110 ${bg} ${
        isSelected ? 'ring-2 ring-white/60' : ''
      }`}
      style={{
        left: leftPos,
        top: topPos,
        transform: transformVal
      }}
      title={
        bbox.scientificName && displayName !== bbox.scientificName
          ? `${displayName} (${bbox.scientificName})`
          : displayName
      }
    >
      {displayName}
    </button>
  )
})

export default BboxLabelMinimal
