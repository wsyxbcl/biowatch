import { is } from '@electron-toolkit/utils'
import { modelZoo, findModel, isModelSupportedOnPlatform } from '../../../shared/mlmodels.js'
import { isJingxi } from '../../../shared/jingxiModel.js'
import { resolveLocalJingxi } from './localJingxi.js'

// Development override (MAZE_JINGXI_* paths); null when unset or packaged.
export function getLocalJingxi() {
  return resolveLocalJingxi({ isDev: is.dev })
}

export function listAvailableModels() {
  const local = getLocalJingxi()
  return modelZoo.flatMap((model) => {
    if (local && isJingxi(model.reference)) return [local.model]
    return isModelSupportedOnPlatform(model, process.platform) ? [model] : []
  })
}

export function findAvailableModel(reference) {
  return (isJingxi(reference) && getLocalJingxi()?.model) || findModel(reference)
}
