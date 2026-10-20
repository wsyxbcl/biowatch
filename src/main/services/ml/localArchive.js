/**
 * Filenames to look for in `offline-assets/` for an archive download URL.
 *
 * The platform aliases (e.g. a fixed `common-Windows.tar.gz`) only stand in
 * for the `common` environment; other archives (models, other environments)
 * must match their own filename, or a bundled common archive would be
 * extracted in their place.
 *
 * @param {string} filename - Archive filename from the download URL
 * @param {{ platform: string, arch: string }} runtime
 * @returns {string[]}
 */
export function localArchiveCandidates(filename, { platform, arch }) {
  if (!filename.startsWith('common-')) return [filename]
  const aliases =
    platform === 'win32'
      ? ['common-Windows.tar.gz']
      : platform === 'darwin' && arch === 'arm64'
        ? ['common-macOS-arm64.tar.gz']
        : []
  return [...aliases, filename]
}
