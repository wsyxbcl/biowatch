import { Mail } from 'lucide-react'
import { REGIONS } from './regions'

export default function CustomModelCard() {
  const region = REGIONS.custom
  return (
    <div
      className="bg-white rounded-lg p-3 mb-2 border border-gray-200 border-dashed mt-3"
      style={{ borderLeft: `4px dashed ${region.color}` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-bold text-sm text-gray-900">Custom model for your region</span>
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ color: region.badgeText, background: region.badgeBg }}
        >
          {region.label}
        </span>
      </div>
      <div className="text-xs text-gray-700 leading-snug mb-2">
        Don&apos;t see a model that fits your region or species? We can{' '}
        <strong>train one for you</strong>, or integrate a model you already have.
      </div>
      <a
        href="https://www.earthtoolsmaker.org/contact"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-900 text-white hover:bg-gray-800"
      >
        <Mail size={12} />
        Get in touch
      </a>
    </div>
  )
}
