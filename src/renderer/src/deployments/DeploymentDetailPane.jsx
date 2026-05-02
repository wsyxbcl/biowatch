import { X } from 'lucide-react'
import DeploymentMediaGallery from '../media/DeploymentMediaGallery'

/**
 * Bottom-pane container for the Deployments tab. Mounted only when a
 * deployment is selected. Header shows the deployment name and a close
 * button. Body for V1 contains DeploymentMediaGallery; later additions
 * (timeline graph, camera-days, species at location) slot in as siblings
 * inside the body.
 */
export default function DeploymentDetailPane({ deployment, onClose }) {
  const title = deployment.locationName || deployment.locationID || deployment.deploymentID

  return (
    <div className="flex flex-col h-full bg-white border-t border-gray-200 min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-700 truncate" title={title}>
          {title} — media
        </h2>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
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
