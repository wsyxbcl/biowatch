import { useQuery } from '@tanstack/react-query'
import { modelZoo, isModelSupportedOnPlatform } from '../../../shared/mlmodels.js'

const platformModels = () =>
  modelZoo.filter((model) => isModelSupportedOnPlatform(model, window.electron.process.platform))

export function useAvailableModels() {
  const { data } = useQuery({
    queryKey: ['availableModels'],
    queryFn: () => window.api.listAvailableModels(),
    staleTime: 10000
  })
  return data ?? platformModels()
}
