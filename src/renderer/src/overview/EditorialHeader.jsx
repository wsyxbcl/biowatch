import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, ChevronDown, ChevronUp } from 'lucide-react'
import ContributorByline from './ContributorByline'
import ContributorsModal from './ContributorsModal'

/**
 * Editorial header — title + description + contributor byline (left column)
 * and a `mapSlot` (right column).
 *
 * Editing affordances are hidden until hover, surfaced via a single `group`
 * class on the left column.
 *
 * @param {Object} props
 * @param {string} props.studyId
 * @param {string} props.studyName
 * @param {Object} props.studyData - Full study `data` object (description, contributors, taxonomic, …).
 * @param {React.ReactNode} props.mapSlot - The right-column content (typically <DeploymentMap />).
 */
export default function EditorialHeader({ studyId, studyName, studyData, mapSlot }) {
  const queryClient = useQueryClient()

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const titleEditRef = useRef(null)

  // Description editing
  const [editingDescription, setEditingDescription] = useState(false)
  const [editedDescription, setEditedDescription] = useState('')
  const descRef = useRef(null)
  const descEditRef = useRef(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [descTruncated, setDescTruncated] = useState(false)

  // Contributors modal
  const [contributorsOpen, setContributorsOpen] = useState(false)

  const description = studyData?.description || ''

  const startTitleEdit = () => {
    setEditedTitle(studyName)
    setEditingTitle(true)
  }
  const cancelTitle = () => {
    setEditingTitle(false)
    setEditedTitle('')
  }
  const saveTitle = async () => {
    if (editedTitle.trim() && editedTitle !== studyName) {
      await window.api.updateStudy(studyId, { name: editedTitle.trim() })
      queryClient.invalidateQueries({ queryKey: ['study'] })
      queryClient.invalidateQueries({ queryKey: ['studies'] })
    }
    cancelTitle()
  }

  const startDescriptionEdit = () => {
    setEditedDescription(description)
    setEditingDescription(true)
  }
  const cancelDescription = () => {
    setEditingDescription(false)
    setEditedDescription('')
  }
  const saveDescription = async () => {
    try {
      await window.api.updateStudy(studyId, {
        data: { ...studyData, description: editedDescription.trim() }
      })
      queryClient.invalidateQueries({ queryKey: ['study'] })
    } finally {
      cancelDescription()
    }
  }

  // Click-outside to save title
  useEffect(() => {
    if (!editingTitle) return
    const onMouseDown = (e) => {
      if (titleEditRef.current && !titleEditRef.current.contains(e.target)) saveTitle()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTitle, editedTitle, studyName])

  // Click-outside / Escape for description
  useEffect(() => {
    if (!editingDescription) return
    const onMouseDown = (e) => {
      if (descEditRef.current && !descEditRef.current.contains(e.target)) saveDescription()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') cancelDescription()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingDescription, editedDescription])

  // Detect truncation for "Show more"
  useEffect(() => {
    if (!descRef.current || editingDescription) {
      setDescTruncated(false)
      return
    }
    const check = () => {
      const el = descRef.current
      if (el) setDescTruncated(el.scrollHeight > el.clientHeight)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [description, descExpanded, editingDescription])

  return (
    <header className="grid grid-cols-[55%_1fr] gap-6 mb-6">
      <div className="group flex flex-col">
        {/* Title */}
        <div className="flex items-baseline gap-2">
          {editingTitle ? (
            <div ref={titleEditRef} className="flex-1">
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle()
                  else if (e.key === 'Escape') cancelTitle()
                }}
                className="text-2xl font-semibold text-gray-900 bg-transparent border-b-2 border-blue-500 focus:outline-none w-full"
                autoFocus
              />
            </div>
          ) : (
            <>
              <a
                target="_blank"
                rel="noopener noreferrer"
                href={studyData?.homepage}
                className="text-2xl font-semibold text-gray-900 capitalize"
              >
                {studyName}
              </a>
              <button
                type="button"
                onClick={startTitleEdit}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 hover:bg-gray-100 rounded text-gray-400 transition-opacity"
                title="Edit title"
                aria-label="Edit title"
              >
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>

        {/* Description */}
        <div className="relative mt-2 flex-1">
          {editingDescription ? (
            <div ref={descEditRef}>
              <textarea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    saveDescription()
                  } else if (e.key === 'Escape') {
                    cancelDescription()
                  }
                }}
                className="w-full text-sm text-gray-700 leading-relaxed border-2 border-blue-500 rounded p-2 focus:outline-none resize-y min-h-[120px] max-w-prose"
                autoFocus
                placeholder="Camera trap dataset containing deployment information, media files metadata, and species observations collected during wildlife monitoring."
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={startDescriptionEdit}
              className="text-left w-full block max-w-prose px-2 py-1 -mx-2 rounded transition-colors group-hover:outline group-hover:outline-1 group-hover:outline-dashed group-hover:outline-blue-200"
              title="Edit description"
            >
              <div
                ref={descRef}
                className={`text-sm text-gray-700 leading-relaxed ${
                  !descExpanded ? 'line-clamp-5 overflow-hidden' : ''
                }`}
              >
                {description || (
                  <span className="text-gray-400 italic">
                    Camera trap dataset containing deployment information, media files metadata, and
                    species observations collected during wildlife monitoring.
                  </span>
                )}
              </div>
            </button>
          )}
          {!editingDescription && description && (descTruncated || descExpanded) && (
            <button
              type="button"
              onClick={() => setDescExpanded(!descExpanded)}
              className="text-gray-500 text-xs flex items-center hover:text-blue-700 transition-colors mt-1"
            >
              {descExpanded ? (
                <>
                  Show less
                  <ChevronUp size={14} className="ml-1" />
                </>
              ) : (
                <>
                  Show more
                  <ChevronDown size={14} className="ml-1" />
                </>
              )}
            </button>
          )}
        </div>

        {/* Byline */}
        <ContributorByline
          contributors={studyData?.contributors}
          onManageClick={() => setContributorsOpen(true)}
        />
      </div>

      <div className="h-80">{mapSlot}</div>

      <ContributorsModal
        open={contributorsOpen}
        onClose={() => setContributorsOpen(false)}
        studyId={studyId}
        studyData={studyData}
      />
    </header>
  )
}
