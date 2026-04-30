import { Pencil } from 'lucide-react'

/**
 * One KPI tile — icon + label + number + optional sub-detail.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.icon - Lucide icon element (already sized 14x14).
 * @param {string} props.label - Uppercase label text.
 * @param {string} props.value - Pre-formatted number (or "—").
 * @param {string} [props.sub] - Sub-detail line (omitted if falsy).
 * @param {React.ReactNode} [props.subAccent] - Optional accent fragment for the sub line.
 * @param {() => void} [props.onEdit] - When provided, the tile is editable: shows a pencil on hover and clicking the tile (or pencil) calls onEdit.
 */
export default function KpiTile({ icon, label, value, sub, subAccent, onEdit }) {
  const editable = typeof onEdit === 'function'
  const Tag = editable ? 'button' : 'div'

  return (
    <Tag
      type={editable ? 'button' : undefined}
      onClick={editable ? onEdit : undefined}
      className={`group relative w-full bg-white border border-gray-200 rounded-lg px-3.5 py-3.5 text-left transition-colors ${
        editable
          ? 'cursor-pointer hover:border-blue-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300'
          : ''
      }`}
    >
      {editable && (
        <Pencil
          size={11}
          className="absolute top-2 right-2 text-gray-400 opacity-0 group-hover:opacity-60 transition-opacity"
          aria-hidden="true"
        />
      )}

      <div className="flex items-center gap-1.5 mb-1.5 text-blue-600">
        {icon}
        <span className="text-[0.65rem] font-semibold tracking-wide text-gray-500 uppercase">
          {label}
        </span>
      </div>

      <div className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{value}</div>

      {sub && (
        <div className="mt-1.5 text-[0.7rem] text-gray-500">
          {subAccent && <span className="text-blue-700 font-semibold">{subAccent}</span>}
          {subAccent && ' '}
          {sub}
        </div>
      )}
    </Tag>
  )
}
