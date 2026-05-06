/**
 * URL state helpers for the Deployments tab.
 *
 * The selected deployment is mirrored in ?deploymentID=… so deep links
 * round-trip and back/forward work. Group-header selections are list-only
 * state and are NOT mirrored.
 */

/**
 * Resolve the selected deployment from search params and the loaded
 * deployments list. Returns null when:
 *   - the param is missing or empty
 *   - the deployment ID isn't in the loaded list (deleted, wrong study,
 *     stale link)
 *   - the deployments list isn't loaded yet
 *
 * @param {URLSearchParams} searchParams
 * @param {Array<{deploymentID: string}>|null|undefined} deployments
 * @returns {object|null} The matching deployment object or null
 */
export function resolveSelectedDeployment(searchParams, deployments) {
  const id = searchParams.get('deploymentID')
  if (!id) return null
  if (!Array.isArray(deployments)) return null
  return deployments.find((d) => d.deploymentID === id) || null
}

/**
 * Return a new URLSearchParams with the deploymentID set (when given a
 * value) or removed (when given null). Does not mutate the input.
 *
 * @param {URLSearchParams} searchParams
 * @param {string|null} deploymentID
 * @returns {URLSearchParams}
 */
export function withDeploymentParam(searchParams, deploymentID) {
  const next = new URLSearchParams(searchParams)
  if (deploymentID) {
    next.set('deploymentID', deploymentID)
  } else {
    next.delete('deploymentID')
  }
  return next
}
