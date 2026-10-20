export const JINGXI_ID = 'maze-speciesnet-jingxi'
export const JINGXI_VERSION = '0.0.1'
export const JINGXI_DELIVERY_VERSION = '0.1.0-experimental'

// Archives are distributed offline only: Biowatch looks for these filenames in
// `offline-assets/` next to the executable (see findLocalArchive in ml/download.ts).
export const jingxiPythonEnvironment = {
  type: 'conda',
  reference: { id: 'heinishi', version: '0.1.0' },
  platform: {
    windows: {
      downloadURL: 'heinishi-0.1.0-Windows.tar.gz',
      // Estimates until the first CI build; only used for display and progress.
      size_in_MB: 3200,
      size_in_MB_installed: 6000,
      files: 50000
    }
  }
}

export const jingxiModel = {
  reference: { id: JINGXI_ID, version: JINGXI_VERSION },
  pythonEnvironment: jingxiPythonEnvironment.reference,
  name: 'Heinishi Test type 001',
  nameCN: '平西丸 Test type 001',
  downloadURL: `${JINGXI_ID}-${JINGXI_VERSION}.tar.gz`,
  files: 19,
  imagesOnly: false,
  species_data: 'jingxi',
  species_count: 26,
  categoryLabel: 'labels',
  size_in_MB: 457,
  region: 'jingxi',
  description:
    '平西丸 Test type 001, 山水自然保护中心京西物种模型(内测版)，暂未包含鼠类和刺猬. CPU or CUDA, images and videos. Expert review required.'
}

export function isJingxi(reference) {
  return reference?.id === JINGXI_ID && reference?.version === JINGXI_VERSION
}
