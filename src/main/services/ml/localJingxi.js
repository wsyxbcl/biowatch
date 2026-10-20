import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { jingxiModel } from '../../../shared/jingxiModel.js'

export const JINGXI_MANIFEST_SHA256 =
  'f91b10dd27687d44641ffd7b1fdb72102552f01844a4a0c31652d1a738791e9b'

export function resolveLocalJingxi({ isDev, env = process.env, platform = process.platform }) {
  if (!isDev || platform !== 'linux') return null
  const bundlePath = env.MAZE_JINGXI_BUNDLE_PATH
  const pythonPath = env.MAZE_JINGXI_PYTHON_PATH
  if (!bundlePath && !pythonPath) return null
  const model = { ...jingxiModel, local: true, ready: false }
  if (!bundlePath || !pythonPath) {
    model.configurationError = 'Set both MAZE_JINGXI_BUNDLE_PATH and MAZE_JINGXI_PYTHON_PATH.'
    return { model }
  }
  try {
    if (!statSync(bundlePath).isDirectory()) throw new Error('Invalid bundle')
    accessSync(pythonPath, constants.X_OK)
    const manifest = readFileSync(join(bundlePath, 'manifest.json'))
    if (createHash('sha256').update(manifest).digest('hex') !== JINGXI_MANIFEST_SHA256)
      throw new Error('Unexpected bundle')
    accessSync(join(bundlePath, 'runner.py'), constants.R_OK)
    return { model: { ...model, ready: true }, bundlePath: realpathSync(bundlePath), pythonPath }
  } catch {
    model.configurationError =
      'Local model configuration is invalid: check the bundle and Python interpreter.'
    return { model }
  }
}
