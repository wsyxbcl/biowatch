/**
 * Deployment-scoped media gallery — used inside the Deployments tab's
 * detail pane.
 *
 * Wraps the shared Gallery with all filter inputs pinned. The sequences
 * query treats an empty species array as "no species filter — all media"
 * (see src/main/database/queries/sequences.js). speciesReady is passed
 * true because the wrapper has no species cascade to wait on.
 */
import Gallery from './Gallery'

export default function DeploymentMediaGallery({ deploymentID }) {
  return (
    <Gallery
      species={[]}
      dateRange={[null, null]}
      timeRange={{ start: 0, end: 24 }}
      includeNullTimestamps={true}
      speciesReady={true}
      deploymentID={deploymentID}
      embedded={true}
    />
  )
}
