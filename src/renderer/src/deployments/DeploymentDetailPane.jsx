import { X } from 'lucide-react'
import DeploymentMediaGallery from '../media/DeploymentMediaGallery'
import EditableLocationName from './EditableLocationName'

/**
 * Bottom-pane container for the Deployments tab. Mounted only when a
 * deployment is selected. Header shows the inline-editable deployment
 * name and a close button. Body for V1 contains DeploymentMediaGallery;
 * later additions (timeline graph, camera-days, species at location)
 * slot in as siblings inside the body.
 */
export default function DeploymentDetailPane({ deployment, onClose, onRenameLocation }) {
  return (
    <div className="flex flex-col h-full bg-white border-t border-gray-200 min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* isSelected=false keeps the header in the same neutral gray as
              the rest of the pane chrome — the blue "selected" treatment is
              for the list rows where it's a state indicator. */}
          <EditableLocationName
            locationID={deployment.locationID || deployment.deploymentID}
            locationName={deployment.locationName}
            isSelected={false}
            onRename={onRenameLocation}
          />
          <span className="text-sm text-gray-400 flex-shrink-0">— media</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700 flex-shrink-0"
          title="Close (Esc)"
          aria-label="Close media pane"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <DeploymentMediaGallery deploymentID={deployment.deploymentID} />
      </div>
    </div>
  )
}
