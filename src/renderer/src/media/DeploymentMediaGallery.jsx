/**
 * Deployment-scoped media gallery — used inside the Deployments tab's
 * detail pane.
 *
 * Wraps the shared Gallery with all filter inputs pinned (date / time /
 * null timestamps). The species filter is driven from the detail pane's
 * popover; an empty array = "no species filter — all media" (see
 * src/main/database/queries/sequences.js). speciesReady is passed true
 * because the wrapper has no species cascade to wait on.
 */
import Gallery from './Gallery'

export default function DeploymentMediaGallery({ deploymentID, species = [] }) {
  return (
    <Gallery
      species={species}
      dateRange={[null, null]}
      timeRange={{ start: 0, end: 24 }}
      includeNullTimestamps={true}
      speciesReady={true}
      deploymentID={deploymentID}
      embedded={true}
    />
  )
}
