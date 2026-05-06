/**
 * Format a byte count as a human-readable string.
 *
 * Examples:
 *   formatBytes(0)           // "0 B"
 *   formatBytes(512)         // "512 B"
 *   formatBytes(1536)        // "1.5 KB"
 *   formatBytes(260 * 1024 * 1024) // "260 MB"
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`
}
